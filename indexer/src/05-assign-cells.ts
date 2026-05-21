// For each chunk embedding, find its top-M nearest centroids and write
// data/cells.f32 / data/cells.bin? — we write data/assignments.json with
// {N, M, cells: int16 array of length N*M, padded with -1 if fewer.}

import { readFloat32Matrix, dataPath } from './lib/io.js';
import { writeFile } from 'node:fs/promises';
import faiss from 'faiss-node';
import { EMBEDDING_DIM } from '@arkiv-search/shared/embedding';

const M = Number(process.env.M ?? 3);

async function main() {
  const embPath = dataPath('embeddings.f32');
  const centroidsPath = dataPath('centroids.f32');
  const outPath = dataPath('assignments.bin');
  const metaPath = dataPath('assignments.json');

  const X = await readFloat32Matrix(embPath, EMBEDDING_DIM);
  const N = X.length / EMBEDDING_DIM;
  const centroids = await readFloat32Matrix(centroidsPath, EMBEDDING_DIM);
  const C = centroids.length / EMBEDDING_DIM;

  console.log(`Assigning ${N} points to top-${M} of ${C} centroids`);

  // Int16Array suffices for C ≤ 32767.
  if (C > 32767) throw new Error(`C=${C} > Int16 max; widen the assignments format`);
  const cells = new Int16Array(N * M);

  const t0 = Date.now();
  const idx = new faiss.IndexFlatIP(EMBEDDING_DIM);
  idx.add(Array.from(centroids));
  // Batch the queries: a single `Array.from(X)` on N=322k×384 ≈ 123M elements
  // trips V8's array length / allocation limits. 50k vectors per call keeps
  // the boxed-Number temp under ~20M elements.
  const BATCH = 50_000;
  for (let i = 0; i < N; i += BATCH) {
    const end = Math.min(i + BATCH, N);
    const slice = X.subarray(i * EMBEDDING_DIM, end * EMBEDDING_DIM);
    const { labels } = idx.search(Array.from(slice), M);
    // faiss returns labels flat, query-major: row j occupies labels[j*M ... j*M+M-1].
    for (let k = 0; k < (end - i) * M; k++) cells[i * M + k] = labels[k]!;
    console.log(
      `  assigned ${end}/${N} (${(((end - i) / ((Date.now() - t0) / 1000)) || 0).toFixed(0)}/s)`,
    );
  }
  console.log(`Assignment done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // Histogram per-cell occupancy across all M assignments.
  const occ = new Int32Array(C);
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]!;
    if (c >= 0) occ[c]!++;
  }
  const sorted = Array.from(occ).sort((a, b) => a - b);
  console.log(`Cell occupancy (over all M slots): median=${sorted[Math.floor(C / 2)]} p99=${sorted[Math.floor(C * 0.99)]} max=${sorted[C - 1]}`);

  await writeFile(outPath, Buffer.from(cells.buffer, cells.byteOffset, cells.byteLength));
  await writeFile(metaPath, JSON.stringify({ N, M, C, dtype: 'int16' }, null, 2));
  console.log(`Wrote assignments (N=${N} M=${M}) → ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
