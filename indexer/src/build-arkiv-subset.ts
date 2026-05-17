// Build a small self-consistent IVF index from the first N chunks of the
// full corpus. Writes subset artifacts under indexer/data/arkiv-subset/ so
// the Arkiv publish script has a small footprint to upload.
//
//   ARKIV_CHUNKS=500 ARKIV_C=32 ARKIV_M=3 pnpm run build:arkiv-subset
//
// Re-trains centroids on just the N selected chunks (instead of reusing the
// 96k×2048 set), so the published index is internally consistent: every
// chunk's cell_id_* references a centroid that lives in the same publish.

import faiss from 'faiss-node';
import { writeFile } from 'node:fs/promises';
import { mkdirSync, existsSync } from 'node:fs';

import { EMBEDDING_DIM } from '@arkiv-search/shared/embedding';
import { sphericalKMeans } from './lib/kmeans.js';
import { dataPath, readFloat32Matrix, readJsonl, writeFloat32Matrix, writeJsonl } from './lib/io.js';

const N = Number(process.env.ARKIV_CHUNKS ?? 500);
const C = Number(process.env.ARKIV_C ?? 32);
const M = Number(process.env.ARKIV_M ?? 3);
const SEED = Number(process.env.SEED ?? 1);
const MAX_ITER = Number(process.env.MAX_ITER ?? 25);

const SUBSET_DIR = dataPath('arkiv-subset');

interface ChunkRow {
  chunk_index: number;
  parent_doc_id: string;
  title: string;
  url: string;
  text: string;
}

async function main() {
  if (!existsSync(SUBSET_DIR)) mkdirSync(SUBSET_DIR, { recursive: true });

  console.log(`Loading full embeddings…`);
  const allEmb = await readFloat32Matrix(dataPath('embeddings.f32'), EMBEDDING_DIM);
  const totalN = allEmb.length / EMBEDDING_DIM;
  if (totalN < N) throw new Error(`only ${totalN} chunks available, asked for ${N}`);

  console.log(`Reading first ${N} chunks from chunks.jsonl…`);
  const chunks: ChunkRow[] = [];
  for await (const row of readJsonl<ChunkRow>(dataPath('chunks.jsonl'))) {
    chunks.push(row);
    if (chunks.length >= N) break;
  }
  if (chunks.length !== N) throw new Error(`only got ${chunks.length} chunks, expected ${N}`);

  // Slice the embeddings to match.
  const subsetEmb = allEmb.slice(0, N * EMBEDDING_DIM);

  // Train fresh centroids on the subset.
  console.log(`Training C=${C} centroids on N=${N} (max_iter=${MAX_ITER})…`);
  const t0 = Date.now();
  const { centroids, clusterSizes, iterations, converged } = sphericalKMeans(
    subsetEmb, N, C, EMBEDDING_DIM,
    { maxIter: MAX_ITER, seed: SEED, verbose: true },
  );
  const sizes = Array.from(clusterSizes).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)]!;
  const max = sizes[sizes.length - 1]!;
  console.log(`Centroids trained in ${((Date.now() - t0) / 1000).toFixed(1)}s, iter=${iterations}, converged=${converged}, sizes median=${median} max=${max}`);

  // Top-M cell assignment via faiss IndexFlatIP.
  console.log(`Assigning top-${M} of ${C}…`);
  const idx = new faiss.IndexFlatIP(EMBEDDING_DIM);
  idx.add(Array.from(centroids));
  const { labels } = idx.search(Array.from(subsetEmb), M);
  const cells = new Int16Array(N * M);
  for (let i = 0; i < N * M; i++) cells[i] = labels[i]!;

  // Write subset artifacts.
  const subset = (rel: string) => `${SUBSET_DIR}/${rel}`;
  await writeJsonl(subset('chunks.jsonl'), chunks);
  await writeFile(subset('embeddings.f32'), Buffer.from(subsetEmb.buffer, subsetEmb.byteOffset, subsetEmb.byteLength));
  const centroidRows: Float32Array[] = new Array(C);
  for (let c = 0; c < C; c++) centroidRows[c] = centroids.slice(c * EMBEDDING_DIM, (c + 1) * EMBEDDING_DIM);
  await writeFloat32Matrix(subset('centroids.f32'), centroidRows, EMBEDDING_DIM);
  await writeFile(subset('assignments.bin'), Buffer.from(cells.buffer, cells.byteOffset, cells.byteLength));
  await writeFile(subset('assignments.json'), JSON.stringify({ N, M, C, dtype: 'int16' }, null, 2));

  console.log(`Wrote subset artifacts under ${SUBSET_DIR}:`);
  console.log(`  N=${N} C=${C} M=${M} dim=${EMBEDDING_DIM}`);
  console.log(`  total entities to publish: 1 (manifest) + ${C} (centroids) + ${N} (chunks) = ${1 + C + N}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
