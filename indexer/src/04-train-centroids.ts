// Read embeddings.f32 (N * dim), run spherical k-means with C centroids,
// and write data/centroids.f32 (C * dim float32 LE).
//
// Default path: shell out to python/kmeans_gpu.py (PyTorch + CUDA). At
// C=8192 on a GTX 1060 this is ~10× faster than the TS path because
// k-means++ init's N×C dot products map onto cuBLAS.
//
// Fallback path: env CPU=1, or no Python venv present → pure-TS spherical
// k-means with faiss-node for the Lloyd's assignment step. Same wire
// format on both sides.

import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readFloat32Matrix, writeFloat32Matrix, dataPath } from './lib/io.js';
import { sphericalKMeans } from './lib/kmeans.js';
import { EMBEDDING_DIM } from '@arkiv-search/shared/embedding';

const C = Number(process.env.C ?? 256);
const MAX_ITER = Number(process.env.MAX_ITER ?? 25);
const SEED = Number(process.env.SEED ?? 1);
const BATCH = Number(process.env.BATCH ?? 32768);
const FORCE_CPU = process.env.CPU === '1' || process.argv.includes('--cpu');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VENV_PYTHON = path.resolve(__dirname, '../python/.venv/bin/python');
const SIDECAR = path.resolve(__dirname, '../python/kmeans_gpu.py');

async function pythonAvailable(): Promise<boolean> {
  if (!existsSync(VENV_PYTHON) || !existsSync(SIDECAR)) return false;
  try {
    return (await stat(VENV_PYTHON)).isFile();
  } catch {
    return false;
  }
}

async function trainViaPython(inPath: string, outPath: string): Promise<void> {
  console.log(`Training via Python sidecar (${VENV_PYTHON})`);
  const args = [
    SIDECAR,
    '--in', inPath,
    '--out', outPath,
    '--dim', String(EMBEDDING_DIM),
    '--C', String(C),
    '--max-iter', String(MAX_ITER),
    '--seed', String(SEED),
    '--batch', String(BATCH),
  ];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(VENV_PYTHON, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`kmeans_gpu.py exited with code ${code}`));
    });
  });
}

async function trainViaNode(inPath: string, outPath: string): Promise<void> {
  console.log('Training via Node CPU (slow path)');
  const flat = await readFloat32Matrix(inPath, EMBEDDING_DIM);
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

  const rows: Float32Array[] = new Array(C);
  for (let c = 0; c < C; c++) {
    rows[c] = centroids.slice(c * EMBEDDING_DIM, (c + 1) * EMBEDDING_DIM);
  }
  await writeFloat32Matrix(outPath, rows, EMBEDDING_DIM);
  console.log(`Wrote ${C}*${EMBEDDING_DIM} float32 → ${outPath}`);
}

async function main() {
  const embPath = dataPath('embeddings.f32');
  const centroidsPath = dataPath('centroids.f32');

  if (!FORCE_CPU && (await pythonAvailable())) {
    await trainViaPython(embPath, centroidsPath);
  } else {
    if (FORCE_CPU) console.log('CPU=1 set → forcing Node CPU k-means');
    else console.log('Python venv not found → falling back to Node CPU');
    await trainViaNode(embPath, centroidsPath);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
