// Web Worker that runs PCA off the main thread. Power iteration on
// 2048×384 takes ~300 ms in V8 — long enough to make the bootstrap → ready
// transition feel janky if we do it on the UI thread.
//
// Lives in public/ as a standalone JS module so Next's static export
// publishes it verbatim, and the browser can `new Worker()` it directly.
// The PCA function is duplicated from shared/src/pca.ts; keep the two in
// sync if you tweak the algorithm. (The sync fallback in viz-core.ts is
// the other consumer.)

function dot(a, aOff, b, bOff, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s += a[aOff + i] * b[bOff + i];
  return s;
}

function multiplyXtX_v(X, N, D, v, out) {
  const Xv = new Float32Array(N);
  for (let i = 0; i < N; i++) Xv[i] = dot(X, i * D, v, 0, D);
  out.fill(0);
  for (let i = 0; i < N; i++) {
    const xi = Xv[i];
    const base = i * D;
    for (let d = 0; d < D; d++) out[d] = out[d] + X[base + d] * xi;
  }
}

function l2NormalizeInPlace(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const n = Math.sqrt(s);
  if (n === 0) return 0;
  const inv = 1 / n;
  for (let i = 0; i < v.length; i++) v[i] = v[i] * inv;
  return n;
}

function pca(X, N, D, K, opts = {}) {
  const iters = opts.iters ?? 80;
  const mean = new Float32Array(D);
  for (let i = 0; i < N; i++) {
    const base = i * D;
    for (let d = 0; d < D; d++) mean[d] = mean[d] + X[base + d];
  }
  for (let d = 0; d < D; d++) mean[d] = mean[d] / N;
  const Xc = new Float32Array(N * D);
  for (let i = 0; i < N; i++) {
    const base = i * D;
    for (let d = 0; d < D; d++) Xc[base + d] = X[base + d] - mean[d];
  }

  const components = new Float32Array(K * D);
  const variance = [];
  const v = new Float32Array(D);
  const Cv = new Float32Array(D);

  // Mulberry32 — seeded for determinism.
  let s = (opts.seed ?? 1) | 0;
  const rng = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  for (let k = 0; k < K; k++) {
    for (let d = 0; d < D; d++) v[d] = rng() - 0.5;
    l2NormalizeInPlace(v);

    let lambda = 0;
    for (let it = 0; it < iters; it++) {
      multiplyXtX_v(Xc, N, D, v, Cv);
      for (let kp = 0; kp < k; kp++) {
        const proj = dot(Cv, 0, components, kp * D, D);
        for (let d = 0; d < D; d++) Cv[d] = Cv[d] - proj * components[kp * D + d];
      }
      lambda = dot(v, 0, Cv, 0, D);
      const n = l2NormalizeInPlace(Cv);
      if (n === 0) break;
      v.set(Cv);
    }
    components.set(v, k * D);
    variance.push(lambda / (N - 1));
  }

  const projected = new Float32Array(N * K);
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < K; k++) projected[i * K + k] = dot(Xc, i * D, components, k * D, D);
  }

  return { components, projected, mean, variance, N, D, K };
}

self.onmessage = (ev) => {
  const { centroids, C, dim, K, iters, seed } = ev.data;
  const result = pca(centroids, C, dim, K, { iters, seed });
  self.postMessage(result, {
    transfer: [
      result.components.buffer,
      result.projected.buffer,
      result.mean.buffer,
    ],
  });
};
