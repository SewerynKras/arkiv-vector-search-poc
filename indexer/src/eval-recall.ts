// Offline recall@10 of IVF (nprobe, M) vs brute-force exact KNN.
// Picks NUM_QUERIES random chunks, uses their embeddings as queries, and
// measures how often IVF top-K matches the brute-force top-K.

import { readFile } from 'node:fs/promises';
import { readFloat32Matrix, dataPath } from './lib/io.js';
import { mulberry32 } from './lib/kmeans.js';
import { EMBEDDING_DIM } from '@arkiv-search/shared/embedding';
import { scoreCentroids, topK } from '@arkiv-search/shared/ivf';

const NUM_QUERIES = Number(process.env.QUERIES ?? 100);
const TOP_K = Number(process.env.K ?? 10);
const NPROBE = Number(process.env.NPROBE ?? 4);
const SEED = Number(process.env.SEED ?? 42);

function dotRow(a: Float32Array, b: Float32Array, bRow: number, dim: number): number {
  let s = 0;
  const bOff = bRow * dim;
  for (let d = 0; d < dim; d++) s += a[d]! * b[bOff + d]!;
  return s;
}

function bruteforceTopK(query: Float32Array, X: Float32Array, N: number, dim: number, k: number, excludeIdx: number): number[] {
  const scores = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    scores[i] = i === excludeIdx ? -Infinity : dotRow(query, X, i, dim);
  }
  return topK(scores, k);
}

function ivfTopK(
  query: Float32Array,
  X: Float32Array, N: number, dim: number,
  centroids: Float32Array, C: number,
  cells: Int16Array, M: number,
  nprobe: number, k: number, excludeIdx: number,
): { top: number[]; candidates: number } {
  const cScores = scoreCentroids(query, centroids, dim, C);
  const probed = new Set(topK(cScores, nprobe));

  const isCandidate = new Uint8Array(N);
  let candidates = 0;
  for (let i = 0; i < N; i++) {
    for (let m = 0; m < M; m++) {
      const c = cells[i * M + m]!;
      if (c < 0) break;
      if (probed.has(c)) { isCandidate[i] = 1; candidates++; break; }
    }
  }

  // Rerank candidates with exact dot product.
  const scored: { i: number; s: number }[] = [];
  for (let i = 0; i < N; i++) {
    if (!isCandidate[i] || i === excludeIdx) continue;
    scored.push({ i, s: dotRow(query, X, i, dim) });
  }
  scored.sort((a, b) => b.s - a.s);
  return { top: scored.slice(0, k).map((x) => x.i), candidates };
}

function loadInt16(buf: Buffer): Int16Array {
  // Copy into a fresh, aligned ArrayBuffer.
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return new Int16Array(ab);
}

async function main() {
  const X = await readFloat32Matrix(dataPath('embeddings.f32'), EMBEDDING_DIM);
  const N = X.length / EMBEDDING_DIM;
  const centroids = await readFloat32Matrix(dataPath('centroids.f32'), EMBEDDING_DIM);
  const C = centroids.length / EMBEDDING_DIM;
  const meta = JSON.parse(await readFile(dataPath('assignments.json'), 'utf8')) as { N: number; M: number; C: number };
  const cells = loadInt16(await readFile(dataPath('assignments.bin')));
  const M = meta.M;
  if (meta.N !== N) throw new Error(`assignments.N=${meta.N} != embeddings.N=${N}`);
  if (cells.length !== N * M) throw new Error(`cells.length=${cells.length} != N*M=${N * M}`);

  console.log(`N=${N} C=${C} M=${M} nprobe=${NPROBE} k=${TOP_K} queries=${NUM_QUERIES}`);

  const rng = mulberry32(SEED);
  const qSet = new Set<number>();
  while (qSet.size < Math.min(NUM_QUERIES, N)) qSet.add(Math.floor(rng() * N));
  const queries = [...qSet];

  let totalHits = 0;
  let totalCandidates = 0;
  let zeroRecall = 0;
  let minRecall = Infinity;
  const t0 = Date.now();

  for (const qi of queries) {
    const q = X.slice(qi * EMBEDDING_DIM, (qi + 1) * EMBEDDING_DIM);
    const bf = bruteforceTopK(q, X, N, EMBEDDING_DIM, TOP_K, qi);
    const { top, candidates } = ivfTopK(q, X, N, EMBEDDING_DIM, centroids, C, cells, M, NPROBE, TOP_K, qi);
    const bfSet = new Set(bf);
    const hits = top.filter((i) => bfSet.has(i)).length;
    const r = hits / TOP_K;
    totalHits += hits;
    totalCandidates += candidates;
    if (r === 0) zeroRecall++;
    if (r < minRecall) minRecall = r;
  }
  const dt = (Date.now() - t0) / 1000;

  const recall = totalHits / (queries.length * TOP_K);
  const avgCandidates = totalCandidates / queries.length;
  console.log(`recall@${TOP_K} = ${recall.toFixed(4)}`);
  console.log(`avg candidates / query = ${avgCandidates.toFixed(0)} (≈ ${((avgCandidates / N) * 100).toFixed(1)}% of N)`);
  console.log(`zero-recall queries: ${zeroRecall}, worst recall: ${minRecall.toFixed(2)}`);
  console.log(`eval time: ${dt.toFixed(1)}s`);

  const pass = recall >= 0.9;
  console.log(pass ? `PASS — recall@${TOP_K} ≥ 0.90` : `FAIL — recall@${TOP_K} < 0.90 (try larger nprobe or M)`);
  if (!pass) process.exit(2);
}

main().catch((e) => { console.error(e); process.exit(1); });
