// Read embeddings.f32 (N * dim), run spherical k-means with C centroids,
// and write data/centroids.f32 (C * dim float32 LE).

import { readFloat32Matrix, writeFloat32Matrix, dataPath } from './lib/io.js';
import { sphericalKMeans } from './lib/kmeans.js';
import { EMBEDDING_DIM } from '@arkiv-search/shared/embedding';

const C = Number(process.env.C ?? 256);
const MAX_ITER = Number(process.env.MAX_ITER ?? 25);
const SEED = Number(process.env.SEED ?? 1);

async function main() {
  const embPath = dataPath('embeddings.f32');
  const centroidsPath = dataPath('centroids.f32');

  console.log(`Loading embeddings from ${embPath}`);
  const flat = await readFloat32Matrix(embPath, EMBEDDING_DIM);
  const N = flat.length / EMBEDDING_DIM;
  console.log(`N=${N} dim=${EMBEDDING_DIM} → training C=${C} centroids (max_iter=${MAX_ITER}, seed=${SEED})`);

  const t0 = Date.now();
  const { centroids, iterations, converged, clusterSizes } = sphericalKMeans(
    flat, N, C, EMBEDDING_DIM,
    { maxIter: MAX_ITER, seed: SEED, verbose: true },
  );
  const dt = (Date.now() - t0) / 1000;

  const sizes = Array.from(clusterSizes).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)]!;
  const p99 = sizes[Math.floor(sizes.length * 0.99)]!;
  const empty = sizes.filter((s) => s === 0).length;
  const max = sizes[sizes.length - 1]!;

  console.log(`Done in ${dt.toFixed(1)}s, iterations=${iterations} converged=${converged}`);
  console.log(`Cluster sizes: median=${median} p99=${p99} max=${max} empty=${empty}`);

  // Pack centroids as rows.
  const rows: Float32Array[] = new Array(C);
  for (let c = 0; c < C; c++) {
    rows[c] = centroids.slice(c * EMBEDDING_DIM, (c + 1) * EMBEDDING_DIM);
  }
  await writeFloat32Matrix(centroidsPath, rows, EMBEDDING_DIM);
  console.log(`Wrote ${C}*${EMBEDDING_DIM} float32 → ${centroidsPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
