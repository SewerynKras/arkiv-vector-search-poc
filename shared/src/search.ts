// Search pipeline shared between the Node CLI and the browser client.
// Embeds locally, scores centroids, paginates the entity API, reranks.
//
// The optional `onEvent` callback receives discriminated-union events at
// each stage; the UI (or eval harness) can render them live. Events are
// awaited, so a UI handler can `await raf()` to let the browser repaint
// between stages.

import { MODEL_ID, embedOne, EMBEDDING_DIM } from "./embedding";
import { scoreCentroids, topK, l2NormalizeInPlace } from "./ivf";
import { dotPackedInt8 } from "./quantize";
import type { Manifest, ChunkPayload } from "./schema";

import {
  type ApiClient,
  buildIvfPredicate,
  decodeCentroidPayload,
  decodeChunk,
  decodeManifest,
  dslString,
} from "./api-client";
import { scopeClause } from "./arkiv";

export const DEFAULT_CENTROID_SET_ID = "ivf-v1";

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
}

export interface BootstrapResult {
  manifest: Manifest;
  centroids: Float32Array; // C * dim, indexed by cell_id
  /** Entity key per cell_id (the chain-assigned hex key on Arkiv, or the
   * synthetic `centroid:<set>:<n>` key on the local SQLite path). Indexed
   * by cell_id; entries may be empty strings if a cell was never loaded. */
  centroidKeys: string[];
  C: number;
  fetchMs: number;
}

export async function bootstrap(
  api: ApiClient,
  opts: { centroidSetId?: string; events?: BootstrapEvents } = {},
): Promise<BootstrapResult> {
  const setId = opts.centroidSetId ?? DEFAULT_CENTROID_SET_ID;
  const ev = opts.events ?? {};
  const t0 = Date.now();

  await ev.onManifestStart?.();
  const manifestQ = `kind = "manifest" && model_id = ${dslString(MODEL_ID)} && centroid_set_id = ${dslString(setId)} && ${scopeClause()}`;
  // We expect exactly one manifest. queryPage suffices and avoids over-fetching
  // multiple pages from chains (like Arkiv) that always return a cursor.
  const mPage = await api.queryPage(manifestQ, 1, null);
  if (mPage.entities.length === 0)
    throw new Error(`manifest not found for ${MODEL_ID}/${setId}`);
  const manifest = decodeManifest(mPage.entities[0]!);
  if (manifest.dim !== EMBEDDING_DIM)
    throw new Error(
      `manifest.dim=${manifest.dim} != EMBEDDING_DIM=${EMBEDDING_DIM}`,
    );
  await ev.onManifestDone?.(manifest, Date.now() - t0);

  const centroidQ = `kind = "centroid" && model_id = ${dslString(MODEL_ID)} && centroid_set_id = ${dslString(setId)} && ${scopeClause()}`;
  const centroids = new Float32Array(manifest.C * manifest.dim);
  const centroidKeys: string[] = new Array(manifest.C).fill("");
  let total = 0;
  let pageIdx = 0;
  let pageToken: string | null = null;
  while (true) {
    const page = await api.queryPage(centroidQ, 200, pageToken);
    for (const e of page.entities) {
      const cid = e.numericAttributes["cell_id"];
      if (cid === undefined)
        throw new Error(`centroid ${e.key} missing cell_id`);
      const vec = decodeCentroidPayload(e, manifest.dim);
      centroids.set(vec, cid * manifest.dim);
      centroidKeys[cid] = e.key;
    }
    total += page.entities.length;
    pageIdx++;
    await ev.onCentroidPage?.(pageIdx, page.entities.length, total, manifest.C);
    // Stop on no cursor OR on an empty page — Arkiv returns a cursor even
    // when the next page is empty, so we can't trust !nextPageToken alone.
    if (!page.nextPageToken || page.entities.length === 0) break;
    pageToken = page.nextPageToken;
    if (pageIdx > 64) throw new Error("centroid pagination runaway");
  }
  if (total !== manifest.C)
    throw new Error(`got ${total} centroids, expected ${manifest.C}`);
  await ev.onCentroidsDone?.(Date.now() - t0);

  return {
    manifest,
    centroids,
    centroidKeys,
    C: manifest.C,
    fetchMs: Date.now() - t0,
  };
}

export interface SearchResult {
  text: string;
  title: string;
  url: string;
  parent_doc_id: string;
  score: number;
  cellIds: number[];
  key: string;
}

export const MAX_CHUNKS_PER_GROUP = 3;

export interface SearchResultGroup {
  parent_doc_id: string;
  title: string;
  url: string;
  // Top-scoring chunks for this article, ordered by score desc, capped at MAX_CHUNKS_PER_GROUP.
  chunks: SearchResult[];
  // Total chunks from this article present in the candidate pool (>= chunks.length).
  totalInGroup: number;
}

export interface SearchStats {
  probedCells: number[];
  pages: number;
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
      /** Full L2-normalised query embedding. Consumers that just want a
       * preview should use `qPreview`; this is the full `dim`-length vector
       * (currently 384) needed by the 3D viz to project the query into the
       * centroid PCA space. */
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
  | { type: "rerank:tick"; processed: number; topK: SearchResult[] }
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
  for (let i = 0; i < qVec.length; i++) qn += qVec[i]! * qVec[i]!;
  // Compute a few interpretable stats so the UI can show something more
  // informative than the always-1.000 L2 norm.
  let qMin = Infinity,
    qMax = -Infinity,
    qAbsSum = 0;
  for (let i = 0; i < qVec.length; i++) {
    const v = qVec[i]!;
    if (v < qMin) qMin = v;
    if (v > qMax) qMax = v;
    qAbsSum += Math.abs(v);
  }
  const qPreview = qVec.slice(0, 16);
  await onEvent?.({
    type: "embed:done",
    ms: embedMs,
    queryNorm: Math.sqrt(qn),
    qPreview,
    // Share a fresh copy so downstream consumers (e.g. the 3D viz) can
    // hold onto it without worrying about later mutation. qVec itself is
    // reused in-place by callers below.
    qVec: new Float32Array(qVec),
    qStats: { min: qMin, max: qMax, meanAbs: qAbsSum / qVec.length },
  });

  const inner = await searchByEmbedding(
    api,
    manifest,
    centroids,
    qVec,
    opts,
    embedMs,
  );
  // The done event from searchByEmbedding already includes totalMs from
  // its own start; replace it with the wall-clock total here so the embed
  // step is included in totalMs.
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

  const ivfPredicate = buildIvfPredicate(probedCells, manifest.M);
  const termCount = probedCells.length * manifest.M;
  let dsl = `${ivfPredicate} && kind = "chunk" && model_id = ${dslString(manifest.model_id)} && centroid_set_id = ${dslString(manifest.centroid_set_id)} && ${scopeClause()}`;
  if (opts.filter) dsl += ` && (${opts.filter})`;
  await onEvent?.({ type: "query:built", dsl, termCount });

  const fetchT0 = Date.now();
  let pages = 0;
  let candidates = 0;
  interface Cand {
    score: number;
    payload: ChunkPayload;
    cellIds: number[];
    key: string;
  }
  const allCandidates: Cand[] = [];

  let pageToken: string | null = null;
  while (pages < maxPages) {
    const pageIdx = pages + 1;
    await onEvent?.({ type: "page:start", pageIdx });
    const pageT0 = Date.now();
    const page = await api.queryPage(dsl, pageSize, pageToken);
    pages++;
    for (const e of page.entities) {
      const chunk = decodeChunk(e);
      const score = dotPackedInt8(qVec, chunk.emb);
      const cellIds = [
        e.numericAttributes["cell_id_0"] ?? -1,
        e.numericAttributes["cell_id_1"] ?? -1,
        e.numericAttributes["cell_id_2"] ?? -1,
      ];
      candidates++;
      allCandidates.push({ score, payload: chunk, cellIds, key: e.key });
    }
    const pageMs = Date.now() - pageT0;
    await onEvent?.({
      type: "page:done",
      pageIdx,
      entities: page.entities.length,
      totalCandidates: candidates,
      ms: pageMs,
      hasMore: !!page.nextPageToken,
    });
    if (!page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }
  const fetchMs = Date.now() - fetchT0;

  // Sort all candidates by score desc. We use this both for the flat top-K
  // (preserves recall-eval semantics) and to derive top-K groups.
  allCandidates.sort((a, b) => b.score - a.score);

  const toResult = (c: Cand): SearchResult => ({
    text: c.payload.text,
    title: c.payload.title,
    url: c.payload.url,
    parent_doc_id: c.payload.parent_doc_id,
    score: c.score,
    cellIds: c.cellIds,
    key: c.key,
  });
  const results: SearchResult[] = allCandidates.slice(0, k).map(toResult);

  // Group all candidates by parent_doc_id, then take top-K groups ordered by
  // their best chunk's score. Within each group, chunks remain in score-desc
  // order (the candidate list was already sorted), and we surface up to
  // MAX_CHUNKS_PER_GROUP of them with a count of the rest.
  const byDoc = new Map<string, Cand[]>();
  for (const c of allCandidates) {
    const arr = byDoc.get(c.payload.parent_doc_id);
    if (arr) arr.push(c);
    else byDoc.set(c.payload.parent_doc_id, [c]);
  }
  const groups: SearchResultGroup[] = Array.from(byDoc.entries())
    .map(([docId, arr]) => {
      const head = arr[0]!;
      return {
        parent_doc_id: docId,
        title: head.payload.title,
        url: head.payload.url,
        chunks: arr.slice(0, MAX_CHUNKS_PER_GROUP).map(toResult),
        totalInGroup: arr.length,
      };
    })
    .sort((a, b) => b.chunks[0]!.score - a.chunks[0]!.score)
    .slice(0, k);
  const stats: SearchStats = {
    probedCells,
    pages,
    candidates,
    termCount,
    embedMs,
    fetchMs,
    rerankMs: 0,
    totalMs: Date.now() - startT + embedMs,
  };
  return { results, groups, stats };
}
