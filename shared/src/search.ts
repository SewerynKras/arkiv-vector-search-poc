// Search pipeline shared between the Node CLI and the browser client.
// Embeds locally, scores centroids in raw float space, fetches chunk
// buckets for the probed cells, then reranks via TurboQuant.dot against
// the WASM-quantized embeddings.
//
// The optional `onEvent` callback receives discriminated-union events at
// each stage; the UI (or eval harness) can render them live. Events are
// awaited, so a UI handler can `await raf()` to let the browser repaint
// between stages.

import { MODEL_ID, embedOne, EMBEDDING_DIM } from "./embedding";
import { scoreCentroids, topK, l2NormalizeInPlace } from "./ivf";
import { TurboQuant, padToTqDim } from "./quantize";
import type { ChunkMini, Manifest } from "./schema";

import {
  type ApiClient,
  buildIvfPredicate,
  decodeCentroidBatch,
  decodeChunkBucket,
  decodeManifest,
  dslString,
} from "./api-client";
import { scopeClause } from "./arkiv";

export const DEFAULT_CENTROID_SET_ID = "ivf-v2";

export interface BootstrapEvents {
  onManifestStart?: () => void | Promise<void>;
  onManifestDone?: (m: Manifest, ms: number) => void | Promise<void>;
  onCentroidPage?: (
    pageIdx: number,
    count: number,
    total: number,
    expected: number,
  ) => void | Promise<void>;
  onCentroidsDone?: (totalMs: number) => void | Promise<void>;
  onCentroidsFromCache?: (C: number) => void | Promise<void>;
  onQuantizerStart?: () => void | Promise<void>;
  onQuantizerDone?: (ms: number) => void | Promise<void>;
}

// Pluggable persistent cache for a centroid set. Keyed by a content-derived
// string so the entry is automatically invalidated when the publisher rolls
// a new set. The Node CLI doesn't pass one; the browser passes an
// IndexedDB-backed adapter.
export interface CentroidCache {
  get(key: string): Promise<{ centroids: Float32Array; centroidKeys: string[] } | null>;
  put(key: string, value: { centroids: Float32Array; centroidKeys: string[] }): Promise<void>;
}

export interface BootstrapResult {
  manifest: Manifest;
  /** Row-major C × dim raw centroids (unrotated). Centroid scoring runs in
   * raw float space; only chunk rerank uses TurboQuant. */
  centroids: Float32Array;
  /** Entity key per cell_id; packed batches share an entity key across
   * all cells in the batch. */
  centroidKeys: string[];
  /** Initialised TurboQuant engine. The browser app keeps this for the
   * lifetime of the page; CLI scripts can call `tq.destroy()` at exit. */
  tq: TurboQuant;
  C: number;
  fetchMs: number;
}

export async function bootstrap(
  api: ApiClient,
  opts: {
    centroidSetId?: string;
    events?: BootstrapEvents;
    cache?: CentroidCache;
  } = {},
): Promise<BootstrapResult> {
  const setId = opts.centroidSetId ?? DEFAULT_CENTROID_SET_ID;
  const ev = opts.events ?? {};
  const t0 = Date.now();

  // --- Manifest -----------------------------------------------------------
  await ev.onManifestStart?.();
  const manifestQ = `kind = "manifest" && model_id = ${dslString(MODEL_ID)} && centroid_set_id = ${dslString(setId)} && ${scopeClause()}`;
  const mPage = await api.queryPage(manifestQ, 1, null);
  if (mPage.entities.length === 0)
    throw new Error(`manifest not found for ${MODEL_ID}/${setId}`);
  const manifest = decodeManifest(mPage.entities[0]!);
  if (manifest.dim !== EMBEDDING_DIM)
    throw new Error(
      `manifest.dim=${manifest.dim} != EMBEDDING_DIM=${EMBEDDING_DIM}`,
    );
  if (manifest.version !== 2)
    throw new Error(
      `manifest version ${manifest.version} unsupported (this client expects v2)`,
    );
  if (manifest.emb_quant !== "tq-wasm")
    throw new Error(
      `unsupported emb_quant=${manifest.emb_quant} (expected "tq-wasm")`,
    );
  await ev.onManifestDone?.(manifest, Date.now() - t0);

  // --- TurboQuant engine init + centroid fetch (parallel) -----------------
  const quantT0 = Date.now();
  await ev.onQuantizerStart?.();
  const tqPromise = TurboQuant.init({
    dim: manifest.tq_dim,
    seed: manifest.tq_seed,
  });

  // --- Centroids ----------------------------------------------------------
  // Cache key is content-derived (`centroid_set_hash`) — a republish under
  // the same `centroid_set_id` with new centroids gets a new hash and
  // therefore a new cache entry, so we never serve stale data.
  const cacheKey = `${MODEL_ID}:${manifest.centroid_set_id}:${manifest.centroid_set_hash}`;
  let centroids: Float32Array;
  let centroidKeys: string[];
  const cached = opts.cache ? await opts.cache.get(cacheKey) : null;
  if (cached) {
    centroids = cached.centroids;
    centroidKeys = cached.centroidKeys;
    await ev.onCentroidsFromCache?.(manifest.C);
  } else {
    const centroidQ = `kind = "centroid" && model_id = ${dslString(MODEL_ID)} && centroid_set_id = ${dslString(setId)} && ${scopeClause()}`;
    centroids = new Float32Array(manifest.C * manifest.dim);
    centroidKeys = new Array(manifest.C).fill("");
    let centTotal = 0;
    let pageIdx = 0;
    let pageToken: string | null = null;
    // Each centroid-bucket payload is K*dim*4 ≈ 122 KB raw → 244 KB hex on
    // the RPC wire. With pageSize=200 the response would be ~6 MB at
    // C=2048, blowing the backend body cap. 8 per page → ~2 MB, safe.
    const CENTROID_PAGE_SIZE = 8;
    while (true) {
      const page = await api.queryPage(centroidQ, CENTROID_PAGE_SIZE, pageToken);
      let pageCentroids = 0;
      for (const e of page.entities) {
        const firstCell = e.numericAttributes["first_cell_id"];
        if (firstCell === undefined)
          throw new Error(`centroid ${e.key} missing first_cell_id`);
        const vec = decodeCentroidBatch(e, manifest.dim);
        const count = vec.length / manifest.dim;
        if (firstCell + count > manifest.C)
          throw new Error(
            `centroid ${e.key}: first_cell_id=${firstCell} + count=${count} > C=${manifest.C}`,
          );
        centroids.set(vec, firstCell * manifest.dim);
        for (let i = 0; i < count; i++) centroidKeys[firstCell + i] = e.key;
        pageCentroids += count;
      }
      centTotal += pageCentroids;
      pageIdx++;
      await ev.onCentroidPage?.(pageIdx, pageCentroids, centTotal, manifest.C);
      if (!page.nextPageToken || page.entities.length === 0) break;
      pageToken = page.nextPageToken;
      if (pageIdx > 64) throw new Error("centroid pagination runaway");
    }
    if (centTotal !== manifest.C)
      throw new Error(`got ${centTotal} centroids, expected ${manifest.C}`);
    // Best-effort persist for next page load. We don't await this to delay
    // the bootstrap, but we don't fire-and-forget either — if the write
    // throws we want it in the console.
    if (opts.cache) {
      opts.cache
        .put(cacheKey, { centroids, centroidKeys })
        .catch((e) => console.warn("[bootstrap] centroid cache write failed:", e));
    }
  }
  await ev.onCentroidsDone?.(Date.now() - t0);

  const tq = await tqPromise;
  await ev.onQuantizerDone?.(Date.now() - quantT0);

  return {
    manifest,
    centroids,
    centroidKeys,
    tq,
    C: manifest.C,
    fetchMs: Date.now() - t0,
  };
}

export interface SearchResult {
  /** Global chunk id; the dedup key when multi-assignment lands a chunk
   * in multiple probed cells. */
  cid: number;
  /** Public link (Wikipedia URL). Title and extract are fetched from the
   * Wikipedia summary API by the UI; not stored on chain. */
  url: string;
  /** Parent document id — grouping key when multiple chunks of one article
   * make it into the candidate pool. */
  pid: string;
  score: number;
  /** Cells whose buckets returned this chunk (∈ probed cells, length ≥ 1). */
  cellIds: number[];
  /** Entity key of one of the buckets it came from — for the Arkiv viewer link. */
  bucketKey: string;
}

export interface SearchResultGroup {
  pid: string;
  url: string;
  bestScore: number;
  /** How many distinct chunks of this article appeared in the candidate pool. */
  hits: number;
  /** The top-scoring chunk for this article — what the result card displays. */
  topResult: SearchResult;
}

export interface SearchStats {
  probedCells: number[];
  pages: number;
  buckets: number;
  candidates: number;
  termCount: number;
  embedMs: number;
  fetchMs: number;
  rerankMs: number;
  totalMs: number;
}

export type SearchEvent =
  | { type: "embed:start" }
  | {
      type: "embed:done";
      ms: number;
      queryNorm: number;
      qPreview: Float32Array;
      qVec: Float32Array;
      qStats: { min: number; max: number; meanAbs: number };
    }
  | {
      type: "centroids:scored";
      cellScores: Float32Array;
      probedCells: number[];
      ms: number;
    }
  | { type: "query:built"; dsl: string; termCount: number }
  | { type: "page:start"; pageIdx: number }
  | {
      type: "page:done";
      pageIdx: number;
      entities: number;
      totalCandidates: number;
      ms: number;
      hasMore: boolean;
    }
  | {
      type: "done";
      results: SearchResult[];
      groups: SearchResultGroup[];
      stats: SearchStats;
    };

export interface SearchOptions {
  k?: number;
  nprobe?: number;
  pageSize?: number;
  maxPages?: number;
  filter?: string; // extra DSL clause AND-ed with the IVF predicate
  onEvent?: (e: SearchEvent) => void | Promise<void>;
}

export async function search(
  api: ApiClient,
  manifest: Manifest,
  centroids: Float32Array,
  tq: TurboQuant,
  queryText: string,
  opts: SearchOptions = {},
): Promise<{
  results: SearchResult[];
  groups: SearchResultGroup[];
  stats: SearchStats;
}> {
  const onEvent = opts.onEvent;
  const t0 = Date.now();

  await onEvent?.({ type: "embed:start" });
  const embT0 = Date.now();
  const qVec = await embedOne(queryText);
  l2NormalizeInPlace(qVec);
  const embedMs = Date.now() - embT0;

  let qn = 0;
  let qMin = Infinity,
    qMax = -Infinity,
    qAbsSum = 0;
  for (let i = 0; i < qVec.length; i++) {
    const v = qVec[i]!;
    qn += v * v;
    if (v < qMin) qMin = v;
    if (v > qMax) qMax = v;
    qAbsSum += Math.abs(v);
  }
  await onEvent?.({
    type: "embed:done",
    ms: embedMs,
    queryNorm: Math.sqrt(qn),
    qPreview: qVec.slice(0, 16),
    qVec: new Float32Array(qVec),
    qStats: { min: qMin, max: qMax, meanAbs: qAbsSum / qVec.length },
  });

  const inner = await searchByEmbedding(
    api,
    manifest,
    centroids,
    tq,
    qVec,
    opts,
    embedMs,
  );
  const stats = { ...inner.stats, totalMs: Date.now() - t0 };
  await onEvent?.({
    type: "done",
    results: inner.results,
    groups: inner.groups,
    stats,
  });
  return { results: inner.results, groups: inner.groups, stats };
}

export async function searchByEmbedding(
  api: ApiClient,
  manifest: Manifest,
  centroids: Float32Array,
  tq: TurboQuant,
  qVec: Float32Array,
  opts: SearchOptions = {},
  embedMs = 0,
): Promise<{
  results: SearchResult[];
  groups: SearchResultGroup[];
  stats: SearchStats;
}> {
  const onEvent = opts.onEvent;
  const k = opts.k ?? 10;
  const nprobe = opts.nprobe ?? manifest.nprobe_default;
  const pageSize = opts.pageSize ?? 200;
  const maxPages = opts.maxPages ?? 10;
  const startT = Date.now();

  // Score centroids in raw float space and pick the nprobe nearest.
  const scoreT0 = Date.now();
  const cellScores = scoreCentroids(qVec, centroids, manifest.dim, manifest.C);
  const probedCells = topK(cellScores, nprobe);
  const scoreMs = Date.now() - scoreT0;
  await onEvent?.({
    type: "centroids:scored",
    cellScores,
    probedCells,
    ms: scoreMs,
  });

  // Build IVF predicate. v2: cell_id = X1 || cell_id = X2 || ...
  const ivfPredicate = buildIvfPredicate(probedCells);
  const termCount = probedCells.length;
  let dsl = `${ivfPredicate} && kind = "chunk_bucket" && model_id = ${dslString(manifest.model_id)} && centroid_set_id = ${dslString(manifest.centroid_set_id)} && ${scopeClause()}`;
  if (opts.filter) dsl += ` && (${opts.filter})`;
  await onEvent?.({ type: "query:built", dsl, termCount });

  // Pad the query once to tq_dim (zero-tail) so we can pass to tq.dot/dotBatch.
  const qPadded = padToTqDim(qVec, manifest.tq_dim);

  interface Cand {
    score: number;
    mini: ChunkMini;
    cellIds: Set<number>;
    bucketKey: string;
  }
  const byCid = new Map<number, Cand>();

  const fetchT0 = Date.now();
  let pages = 0;
  let buckets = 0;
  let pageToken: string | null = null;

  // Page-loop work is intentionally cheap: just decode buckets and dedupe
  // chunks by `cid`. Scoring is deferred to a single tq.dotBatch() call
  // after all pages land (see below). Per-chunk tq.dot() crossed the
  // JS↔WASM boundary thousands of times — at nprobe=16, ~2400 crossings
  // were the dominant ~1s freeze users saw between fetch and results.
  while (pages < maxPages) {
    const pageIdx = pages + 1;
    await onEvent?.({ type: "page:start", pageIdx });
    const pageT0 = Date.now();
    const page = await api.queryPage(dsl, pageSize, pageToken);
    pages++;
    buckets += page.entities.length;
    for (const e of page.entities) {
      const cellId = e.numericAttributes["cell_id"];
      if (cellId === undefined) continue;
      const minis = decodeChunkBucket(e);
      for (const mini of minis) {
        const existing = byCid.get(mini.cid);
        if (existing) {
          existing.cellIds.add(cellId);
          continue;
        }
        byCid.set(mini.cid, {
          score: 0, // filled in by the batched rerank below
          mini,
          cellIds: new Set([cellId]),
          bucketKey: e.key,
        });
      }
    }
    const pageMs = Date.now() - pageT0;
    await onEvent?.({
      type: "page:done",
      pageIdx,
      entities: page.entities.length,
      totalCandidates: byCid.size,
      ms: pageMs,
      hasMore: !!page.nextPageToken,
    });
    if (!page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }
  const fetchMs = Date.now() - fetchT0;

  // Batched rerank: one WASM (or WebGPU) call instead of N individual
  // tq.dot() calls. We concatenate every candidate's compressed embedding
  // into a single Uint8Array and hand it to tq.dotBatch, which returns the
  // matching score for each. The library transparently uses WebGPU when
  // available; on devices without it the WASM SIMD fallback is still ~10×
  // faster than per-vector dot() because it avoids the per-call boundary
  // overhead.
  const rerankT0 = Date.now();
  const candidates = Array.from(byCid.values());
  if (candidates.length > 0) {
    const bytesPerVec = manifest.emb_byte_size;
    const concat = new Uint8Array(candidates.length * bytesPerVec);
    for (let i = 0; i < candidates.length; i++) {
      const emb = candidates[i]!.mini.emb;
      if (emb.byteLength !== bytesPerVec)
        throw new Error(
          `candidate ${i} emb size ${emb.byteLength} != ${bytesPerVec}`,
        );
      concat.set(emb, i * bytesPerVec);
    }
    const scores = await tq.dotBatch(qPadded, concat, bytesPerVec);
    for (let i = 0; i < candidates.length; i++) {
      candidates[i]!.score = scores[i]!;
    }
  }
  const rerankMs = Date.now() - rerankT0;

  const all = candidates.sort((a, b) => b.score - a.score);

  const toResult = (c: Cand): SearchResult => ({
    cid: c.mini.cid,
    url: c.mini.url,
    pid: c.mini.pid,
    score: c.score,
    cellIds: Array.from(c.cellIds),
    bucketKey: c.bucketKey,
  });
  const results: SearchResult[] = all.slice(0, k).map(toResult);

  const byPid = new Map<string, Cand[]>();
  for (const c of all) {
    const arr = byPid.get(c.mini.pid);
    if (arr) arr.push(c);
    else byPid.set(c.mini.pid, [c]);
  }
  const groups: SearchResultGroup[] = Array.from(byPid.entries())
    .map(([pid, arr]): SearchResultGroup => {
      const head = arr[0]!;
      return {
        pid,
        url: head.mini.url,
        bestScore: head.score,
        hits: arr.length,
        topResult: toResult(head),
      };
    })
    .sort((a, b) => b.bestScore - a.bestScore)
    .slice(0, k);

  const stats: SearchStats = {
    probedCells,
    pages,
    buckets,
    candidates: byCid.size,
    termCount,
    embedMs,
    fetchMs,
    rerankMs,
    totalMs: Date.now() - startT + embedMs,
  };
  return { results, groups, stats };
}
