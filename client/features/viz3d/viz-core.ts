// 3D point-cloud visualisation of cluster centroids.
//
// The React wrapper (centroid-viz-3d.tsx) runs PCA in a Web Worker and
// hands the result in via `pcaResult`; this module then scales the 3-component
// projection to fit a unit cube and renders it as a Three.js Points object
// with per-vertex (position, size, color, alpha) attributes. OrbitControls
// drives the camera; mouse + touch work the same.
//
// Public update API:
//   paintScores(scores)  → fade alpha by per-cell similarity rank
//   markProbed(cells)    → enlarge + Arkiv-blue tint on probed cells
//   markHits(cellIds)    → Arkiv-orange ring around cells that produced a top-K result
//   setQueryPoint(qVec)  → black arrow from origin to the query's projection
//   reset()              → back to neutral
//
// Caveat: PCA on 384-D bge embeddings keeps ~10–15% of variance in the top 3
// components. The visualisation is a useful "shape of the embedding space"
// for the demo, but it's not a faithful preservation of nearest-neighbour
// structure. See shared/src/pca.ts.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { pca, type PcaResult } from '@arkiv-search/shared/pca';

export interface CentroidViz3D {
  /** DOM root that hosts the canvas. */
  container: HTMLElement;
  /** Recolour every point by similarity to the current query. Pass the raw
   * per-cell scores; they'll be min/max-normalised internally. */
  paintScores(scores: Float32Array): void;
  /** Highlight cells the query is actually probing. */
  markProbed(cellIds: number[]): void;
  /** Outline cells that contain a top-K result. */
  markHits(cellIds: number[]): void;
  /** Clear scores / probes / hits and go back to neutral. */
  reset(): void;
  /** Project a point's 3D position to canvas-relative (x, y) for tooltip
   * placement. Returns null if the point is behind the camera. */
  pointScreenPos(cellId: number): { x: number; y: number } | null;
  /** Show / move / hide the query-vector marker. Pass the full query embedding
   * (length = dim) to project it into the same PCA + cube space as the
   * centroids; pass `null` to hide. */
  setQueryPoint(qVec: Float32Array | null): void;
  /** Drop GPU resources. */
  dispose(): void;
}

// All sizes are in device pixels. No depth-based scaling: at small point sizes
// (5-20 px) depth attenuation gives almost no perceptual benefit and makes
// the algorithm fragile to camera distance.
const VERT_SHADER = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aAlpha;
  attribute float aHalo;
  attribute float aSelected;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vHalo;
  varying float vSelected;
  varying float vSize;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vHalo = aHalo;
    vSelected = aSelected;
    vSize = aSize;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize;
  }
`;

const FRAG_SHADER = /* glsl */ `
  precision highp float;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vHalo;
  varying float vSelected;
  varying float vSize;
  void main() {
    // Distance from point center, in [0, 0.5].
    vec2 d = gl_PointCoord - vec2(0.5);
    float r = length(d);
    if (r > 0.5) discard;

    // Antialias width in point-space — one pixel.
    float aa = 1.0 / max(vSize, 1.0);

    // Core filled disc at radius 0.40, with a 1-pixel feather.
    float core = 1.0 - smoothstep(0.40 - aa, 0.40, r);

    // Hit ring: thin pink band near the rim, only when vHalo > 0.
    float hitRing = 0.0;
    if (vHalo > 0.0) {
      hitRing = smoothstep(0.40 - aa, 0.40, r) - smoothstep(0.46, 0.46 + aa, r);
    }
    // Selection ring: yellow band even closer to the rim, drawn on top.
    float selRing = 0.0;
    if (vSelected > 0.0) {
      selRing = smoothstep(0.42 - aa, 0.42, r) - smoothstep(0.49, 0.49 + aa, r);
    }

    // Arkiv Orange for the hit ring, warm yellow for selection so the two
    // signals stay independently legible against each other.
    vec3 hitColor = vec3(0.996, 0.455, 0.275);
    vec3 selColor = vec3(1.0, 0.89, 0.48);
    vec3 col = vColor;
    col = mix(col, hitColor, hitRing * vHalo);
    col = mix(col, selColor, selRing * vSelected);
    // Core fades with vAlpha (rank); rings stay fully opaque so probed +
    // hit + selected markers always read clearly even on faded cells.
    float coreA = core * vAlpha;
    float ringA = max(hitRing * vHalo, selRing * vSelected);
    float alpha = max(coreA, ringA);
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

const BASE_SIZE = 9.0;        // baseline dot
const SCORED_BUMP = 6.0;      // grows up to BASE + SCORED_BUMP with similarity
const PROBED_SIZE = 18.0;     // top-nprobe stand out
const HIT_SIZE = 24.0;        // anchor for the pink halo ring
const SELECTED_SIZE = 26.0;   // anchor for click-selected ring

interface CubeFit { cx: number; cy: number; cz: number; k: number }

/** Translate + uniformly scale `positions` into a `scaleTo`-half-extent cube
 * centred on the origin. Returns the transform so additional points (e.g.
 * the projected query vector) can be placed into the same space later. */
function fitToCube(positions: Float32Array, scaleTo = 1.0): CubeFit {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i]! < minX) minX = positions[i]!;
    if (positions[i + 1]! < minY) minY = positions[i + 1]!;
    if (positions[i + 2]! < minZ) minZ = positions[i + 2]!;
    if (positions[i]! > maxX) maxX = positions[i]!;
    if (positions[i + 1]! > maxY) maxY = positions[i + 1]!;
    if (positions[i + 2]! > maxZ) maxZ = positions[i + 2]!;
  }
  const cx = (maxX + minX) / 2, cy = (maxY + minY) / 2, cz = (maxZ + minZ) / 2;
  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const k = (2 * scaleTo) / span;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = (positions[i]! - cx) * k;
    positions[i + 1] = (positions[i + 1]! - cy) * k;
    positions[i + 2] = (positions[i + 2]! - cz) * k;
  }
  return { cx, cy, cz, k };
}

export interface CreateCentroidViz3DOpts {
  /** Container element. The canvas is sized to fill it. */
  container: HTMLElement;
  /** Centroids, row-major C×dim. */
  centroids: Float32Array;
  C: number;
  dim: number;
  /** Optional callback when a cell is hovered (point picking). */
  onHover?: (cellId: number | null) => void;
  /** Fired when the user clicks a point (cellId), or empty space (null). */
  onSelect?: (cellId: number | null) => void;
  /** Pre-computed PCA result. The React canvas runs PCA in a Web Worker and
   * hands the result here so we don't block the main thread on ~300 ms of
   * power iteration during scene init. If omitted (e.g., in tests), we
   * fall back to computing inline. */
  pcaResult?: PcaResult;
}

/** Map a position in [-1, 1]³ to an HSL-derived color. The hue comes from the
 * azimuthal angle in the xy-plane, lightness is biased by z. Mostly decorative
 * — meant to give each centroid a recognisable identity. Saturation is high
 * so the dots stay vivid against the cream Arkiv background; lightness sits
 * in the mid range so neither white nor near-black points get lost. */
function positionToColor(x: number, y: number, z: number, out: THREE.Color) {
  const hue = (Math.atan2(y, x) / (Math.PI * 2) + 1) % 1;        // [0, 1)
  const sat = 0.75 + 0.20 * Math.min(1, Math.hypot(x, y));       // 0.75..0.95
  const light = 0.42 + 0.12 * z;                                 // 0.30..0.54
  out.setHSL(hue, sat, light);
}

export function createCentroidViz3D(opts: CreateCentroidViz3DOpts): CentroidViz3D {
  const { container, centroids, C, dim, onHover, onSelect, pcaResult } = opts;

  // ── PCA → 3D positions ────────────────────────────────────────────────────
  const result = pcaResult ?? (() => {
    const t0 = performance.now();
    const r = pca(centroids, C, dim, 3, { iters: 60 });
    console.log(`[viz3d] PCA (sync fallback) done in ${(performance.now() - t0).toFixed(0)}ms, variance ratios =`, r.variance.map((v) => v.toFixed(3)));
    return r;
  })();
  const positions = new Float32Array(C * 3);
  for (let i = 0; i < C * 3; i++) positions[i] = result.projected[i]!;
  const cubeFit = fitToCube(positions, 1.0);

  // ── three.js setup ────────────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 50);
  camera.position.set(0, 0, 3.3);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x000000, 0);
  container.append(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1.4;
  controls.maxDistance = 8;
  controls.rotateSpeed = 0.7;
  controls.zoomSpeed = 0.6;
  controls.enablePan = false;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.6;

  // Per-centroid base color derived from its 3D position. Doesn't encode any
  // information — just gives each point a stable identity so the eye can track
  // the same cluster across rotations.
  const baseColors = new Float32Array(C * 3);
  const tmpColor = new THREE.Color();
  for (let i = 0; i < C; i++) {
    positionToColor(positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!, tmpColor);
    baseColors[i * 3] = tmpColor.r;
    baseColors[i * 3 + 1] = tmpColor.g;
    baseColors[i * 3 + 2] = tmpColor.b;
  }

  // ── Points geometry + shader ──────────────────────────────────────────────
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const sizes = new Float32Array(C);
  const colors = new Float32Array(C * 3);
  const alphas = new Float32Array(C);
  const halos = new Float32Array(C);
  const selected = new Float32Array(C);
  const initDpr = window.devicePixelRatio || 1;
  for (let i = 0; i < C; i++) {
    sizes[i] = BASE_SIZE * initDpr;
    colors[i * 3] = baseColors[i * 3]!;
    colors[i * 3 + 1] = baseColors[i * 3 + 1]!;
    colors[i * 3 + 2] = baseColors[i * 3 + 2]!;
    alphas[i] = 1.0;
  }
  const aSize = new THREE.BufferAttribute(sizes, 1);
  const aColor = new THREE.BufferAttribute(colors, 3);
  const aAlpha = new THREE.BufferAttribute(alphas, 1);
  const aHalo = new THREE.BufferAttribute(halos, 1);
  const aSelected = new THREE.BufferAttribute(selected, 1);
  geom.setAttribute('aSize', aSize);
  geom.setAttribute('aColor', aColor);
  geom.setAttribute('aAlpha', aAlpha);
  geom.setAttribute('aHalo', aHalo);
  geom.setAttribute('aSelected', aSelected);

  // ── Axes (X=red, Y=green, Z=blue arrows from origin) ──────────────────────
  const axesLen = 1.05;
  const axesGroup = new THREE.Group();
  axesGroup.add(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0), axesLen, 0xff6680, 0.10, 0.05));
  axesGroup.add(new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), axesLen, 0x66e08c, 0.10, 0.05));
  axesGroup.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), axesLen, 0x66c8ff, 0.10, 0.05));
  // Make the arrow lines a bit transparent so they don't fight the points.
  axesGroup.traverse((obj) => {
    const mat = (obj as { material?: THREE.Material | THREE.Material[] }).material;
    if (mat) {
      const apply = (m: THREE.Material) => { m.transparent = true; m.opacity = 0.6; m.depthWrite = false; };
      if (Array.isArray(mat)) mat.forEach(apply); else apply(mat);
    }
  });
  scene.add(axesGroup);

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT_SHADER,
    fragmentShader: FRAG_SHADER,
    transparent: true,
    depthWrite: false,
  });

  const points = new THREE.Points(geom, material);
  scene.add(points);

  // ── Query-vector marker ──────────────────────────────────────────────────
  // A vector reads as an arrow, not a dot — solid-black shaft + cone-tip,
  // anchored at the origin and pointing at the projected query position. The
  // shaft is a unit-length cylinder built along +Y so we can scale it to the
  // projected magnitude and rotate it onto the direction in setQueryPoint().
  // Black against the cream Arkiv background reads stronger than any brand
  // hue: the dots are colourful but light, the arrow stays dominant.
  const ARROW_COLOR = new THREE.Color(0x000000);
  const queryShaftMat = new THREE.MeshBasicMaterial({ color: ARROW_COLOR });
  const queryHeadMat = new THREE.MeshBasicMaterial({ color: ARROW_COLOR });
  const queryShaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.018, 1, 16, 1, false),
    queryShaftMat,
  );
  // CylinderGeometry is centred on the origin; shift its base to y=0 so the
  // shaft grows out from the scene origin when we scale it on Y.
  queryShaft.geometry.translate(0, 0.5, 0);
  const HEAD_LEN = 0.11;
  const queryHead = new THREE.Mesh(
    new THREE.ConeGeometry(0.048, HEAD_LEN, 24),
    queryHeadMat,
  );
  // Same trick — base at the cone's origin, pointing along +Y.
  queryHead.geometry.translate(0, HEAD_LEN / 2, 0);
  const queryArrow = new THREE.Group();
  queryArrow.add(queryShaft);
  queryArrow.add(queryHead);
  // Always draw on top of the (transparent) centroid dots so the arrow never
  // gets visually buried inside the cloud. The dots use depthWrite:false, so
  // bumping renderOrder is enough to keep the arrow in front.
  queryArrow.renderOrder = 10;
  queryShaftMat.depthTest = false;
  queryHeadMat.depthTest = false;
  queryArrow.visible = false;
  scene.add(queryArrow);

  // ── Hover picking ─────────────────────────────────────────────────────────
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points = { threshold: 0.025 };
  const pointer = new THREE.Vector2();
  let hovered: number | null = null;
  function pick(ev: MouseEvent) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(points);
    const next = hits.length > 0 ? (hits[0]!.index ?? null) : null;
    if (next !== hovered) {
      hovered = next;
      onHover?.(hovered);
    }
  }
  renderer.domElement.addEventListener('mousemove', pick);
  renderer.domElement.addEventListener('mouseleave', () => {
    if (hovered !== null) { hovered = null; onHover?.(null); }
  });

  // Click-to-select. We watch for a real click (not a drag) by comparing
  // down/up coordinates: if the pointer moved more than a few pixels, OrbitControls
  // is in charge and we shouldn't fire onSelect.
  let downX = 0, downY = 0, downT = 0;
  renderer.domElement.addEventListener('pointerdown', (ev) => {
    controls.autoRotate = false;
    downX = ev.clientX; downY = ev.clientY; downT = ev.timeStamp;
  });
  renderer.domElement.addEventListener('pointerup', (ev) => {
    const dx = ev.clientX - downX, dy = ev.clientY - downY;
    const drag = Math.hypot(dx, dy);
    const dt = ev.timeStamp - downT;
    if (drag > 5 || dt > 600) return; // it was a drag/zoom, not a click
    pick(ev as MouseEvent);
    if (hovered !== null) selectCell(hovered);
    else selectCell(null);
  });

  // ── Render loop + resize ──────────────────────────────────────────────────
  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  let raf = 0;
  let running = true;
  const tick = () => {
    if (!running) return;
    controls.update();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  };
  tick();

  // ── State updates ─────────────────────────────────────────────────────────
  let lastScores: Float32Array | null = null;
  // Cached sort of cell indices by lastScores desc. Invalidated when
  // `lastScores` changes; reused across markProbed/markHits/select repaints
  // that don't touch the ranking. Sorting 2048 floats every event was the
  // dominant cost when paintScores → markProbed → markHits fire back-to-back.
  let sortedByScore: number[] | null = null;
  const probedSet = new Set<number>();
  const hitSet = new Set<number>();
  let selectedCell: number | null = null;

  // RAF-coalesced repaint. paintScores+markProbed+markHits typically fire
  // within one React batch; without coalescing we'd run repaint() three
  // times back-to-back, each iterating C points and re-uploading five VBOs.
  // With coalescing the three state changes merge into one repaint per frame.
  let repaintScheduled = false;
  function scheduleRepaint() {
    if (repaintScheduled) return;
    repaintScheduled = true;
    requestAnimationFrame(() => {
      repaintScheduled = false;
      repaint();
    });
  }

  function selectCell(id: number | null) {
    if (id === selectedCell) return;
    selectedCell = id;
    scheduleRepaint();
    onSelect?.(id);
  }

  // Per-cell rank intensity in [0, 1]; top match = 1.0, bottom = 0.0. Reused
  // each repaint to avoid GC.
  const intensityByCell = new Float32Array(C);
  // Floor alpha for low-rank cells. Pulled close to zero so anything outside
  // the top few hundred essentially disappears, leaving the constellation
  // dominated by the relevant cells.
  const MIN_ALPHA = 0.03;

  function repaint() {
    if (lastScores) {
      const scores = lastScores;
      // Lazy: recompute sort only when the underlying scores change.
      if (sortedByScore === null) {
        const indices = new Array<number>(C);
        for (let i = 0; i < C; i++) indices[i] = i;
        indices.sort((a, b) => scores[b]! - scores[a]!);
        sortedByScore = indices;
      }
      const indices = sortedByScore;
      // Exponential decay against rank/C with a strong coefficient. At C=2048:
      //   rank   0 → 1.000   (top match, fully opaque)
      //   rank  20 → 0.925
      //   rank 100 → 0.677
      //   rank 200 → 0.458
      //   rank 500 → 0.142
      //   rank 1k  → 0.020
      //   rank 2k  → 0.000   (clamped by MIN_ALPHA = 0.03)
      // K=5 left too many cells looking near-opaque; K=8 keeps the head of
      // the list clearly visible while collapsing the long tail.
      const K = 8;
      for (let r = 0; r < indices.length; r++) {
        const i = indices[r]!;
        intensityByCell[i] = Math.exp((-K * r) / Math.max(C - 1, 1));
      }
    } else {
      // No query yet: everything fully visible at its base hue.
      intensityByCell.fill(1);
    }
    // Scale point sizes by devicePixelRatio so retina displays look right.
    const dpr = window.devicePixelRatio || 1;

    for (let i = 0; i < C; i++) {
      // Keep the per-point base colour (HSL by position) at full saturation
      // — rank is communicated via alpha so low-rank cells fade rather than
      // dim. Probed cells get a cyan override so they pop unambiguously.
      let r = baseColors[i * 3]!;
      let g = baseColors[i * 3 + 1]!;
      let b = baseColors[i * 3 + 2]!;
      let size = BASE_SIZE;
      let halo = 0;
      let sel = 0;
      let alpha = 1;
      if (lastScores) {
        const intensity = intensityByCell[i]!;
        alpha = MIN_ALPHA + (1 - MIN_ALPHA) * intensity;
        size = BASE_SIZE + intensity * SCORED_BUMP;
      }
      if (probedSet.has(i)) {
        size = PROBED_SIZE;
        // Arkiv Blue (#181EA9) — deep saturated indigo, reads strongly
        // against both the cream background and the rainbow base hues.
        r = 0.094; g = 0.118; b = 0.663;
        alpha = 1;
      }
      if (hitSet.has(i)) {
        halo = 1.0;
        alpha = 1;
        if (size < HIT_SIZE) size = HIT_SIZE;
      }
      if (selectedCell === i) {
        sel = 1.0;
        alpha = 1;
        if (size < SELECTED_SIZE) size = SELECTED_SIZE;
      }
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
      alphas[i] = alpha;
      sizes[i] = size * dpr;
      halos[i] = halo;
      selected[i] = sel;
    }
    aSize.needsUpdate = true;
    aColor.needsUpdate = true;
    aAlpha.needsUpdate = true;
    aHalo.needsUpdate = true;
    aSelected.needsUpdate = true;
  }

  return {
    container,
    paintScores(scores) {
      lastScores = scores;
      sortedByScore = null; // invalidate sort cache
      probedSet.clear();
      hitSet.clear();
      scheduleRepaint();
    },
    markProbed(cells) {
      probedSet.clear();
      for (const c of cells) if (c >= 0 && c < C) probedSet.add(c);
      scheduleRepaint();
    },
    markHits(cells) {
      hitSet.clear();
      for (const c of cells) if (c >= 0 && c < C) hitSet.add(c);
      scheduleRepaint();
    },
    reset() {
      lastScores = null;
      sortedByScore = null;
      probedSet.clear();
      hitSet.clear();
      selectedCell = null;
      controls.autoRotate = true;
      queryArrow.visible = false;
      scheduleRepaint();
    },
    pointScreenPos(cellId) {
      if (cellId < 0 || cellId >= C) return null;
      const v = new THREE.Vector3(
        positions[cellId * 3]!,
        positions[cellId * 3 + 1]!,
        positions[cellId * 3 + 2]!,
      );
      v.project(camera);
      if (v.z > 1 || v.z < -1) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      return {
        x: (v.x + 1) * 0.5 * rect.width,
        y: (1 - (v.y + 1) * 0.5) * rect.height,
      };
    },
    setQueryPoint(qVec) {
      if (!qVec || qVec.length !== dim) {
        queryArrow.visible = false;
        return;
      }
      // Project qVec into the same PCA basis the centroids were drawn from:
      //   proj_k = <qVec - mean, component_k>
      // then apply the cube fit (same per-axis centre, same uniform scale) so
      // it lands in the visible [-1, 1] box alongside the centroid points.
      const { mean, components } = result;
      const cs = [cubeFit.cx, cubeFit.cy, cubeFit.cz];
      const out = new THREE.Vector3();
      const target = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        let proj = 0;
        for (let d = 0; d < dim; d++) proj += (qVec[d]! - mean[d]!) * components[k * dim + d]!;
        target[k] = (proj - cs[k]!) * cubeFit.k;
      }
      out.set(target[0]!, target[1]!, target[2]!);
      const len = out.length();
      if (len < 1e-6) {
        // Degenerate case: query collapsed exactly to the origin. Hide rather
        // than render an arrow with no direction.
        queryArrow.visible = false;
        return;
      }
      // Shaft: scale Y to (len - HEAD_LEN) so the cone tip lands exactly at
      // the projected query position. Cap the shaft length to a small minimum
      // so the cone doesn't overshoot when the query lands near the origin.
      const shaftLen = Math.max(0.02, len - HEAD_LEN);
      queryShaft.scale.set(1, shaftLen, 1);
      // Head sits at the end of the shaft along +Y (local), pointing further.
      queryHead.position.set(0, shaftLen, 0);
      // Rotate the whole arrow so its local +Y points at `out`. setFromUnitVectors
      // gives the shortest-arc rotation between two unit vectors.
      const dir = out.clone().normalize();
      queryArrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      queryArrow.visible = true;
    },
    dispose() {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      geom.dispose();
      material.dispose();
      queryShaft.geometry.dispose();
      queryHead.geometry.dispose();
      queryShaftMat.dispose();
      queryHeadMat.dispose();
      renderer.dispose();
      controls.dispose();
      renderer.domElement.remove();
    },
  };
}
