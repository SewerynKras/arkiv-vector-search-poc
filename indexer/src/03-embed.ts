// Embed every chunk in chunks.jsonl and write embeddings.f32.
//
// Default path: shell out to python/embed_gpu.py (pytorch + manual mean pool
// on CUDA). Mean cosine vs the browser's INT8 ONNX path is ~0.997 (verified
// at 5k scale) and throughput is ~250 chunks/s on a GTX 1060 vs ~13/s on
// Node CPU.
//
// Fallback path: env CPU=1, or no Python venv present → embed via Node ORT
// using the same pipeline the browser uses.

import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readJsonl, dataPath, writeFloat32Matrix } from './lib/io.js';
import { embedBatch, EMBEDDING_DIM } from '@arkiv-search/shared/embedding';

const BATCH_SIZE = Number(process.env.BATCH ?? 64);
const FORCE_CPU = process.env.CPU === '1' || process.argv.includes('--cpu');

interface ChunkRow { text: string }

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VENV_PYTHON = path.resolve(__dirname, '../python/.venv/bin/python');
const SIDECAR = path.resolve(__dirname, '../python/embed_gpu.py');

async function pythonAvailable(): Promise<boolean> {
  if (!existsSync(VENV_PYTHON) || !existsSync(SIDECAR)) return false;
  try {
    const s = await stat(VENV_PYTHON);
    return s.isFile();
  } catch {
    return false;
  }
}

async function embedViaPython(inPath: string, outPath: string): Promise<void> {
  console.log(`Embedding via Python sidecar (${VENV_PYTHON})`);
  const args = [SIDECAR, '--in', inPath, '--out', outPath, '--batch', String(BATCH_SIZE)];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(VENV_PYTHON, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`embed_gpu.py exited with code ${code}`));
    });
  });
}

async function embedViaNode(inPath: string, outPath: string): Promise<void> {
  console.log('Embedding via Node CPU (slow path)');
  const texts: string[] = [];
  for await (const row of readJsonl<ChunkRow>(inPath)) texts.push(row.text);
  const out: Float32Array[] = new Array(texts.length);
  let done = 0;
  const t0 = Date.now();
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const vecs = await embedBatch(texts.slice(i, i + BATCH_SIZE));
    for (let j = 0; j < vecs.length; j++) out[i + j] = vecs[j]!;
    done += vecs.length;
    if (done % 200 === 0 || done === texts.length) {
      const dt = (Date.now() - t0) / 1000;
      const rate = done / dt;
      console.log(`  embedded ${done}/${texts.length} (${rate.toFixed(1)}/s, ETA ${((texts.length - done) / rate).toFixed(0)}s)`);
    }
  }
  await writeFloat32Matrix(outPath, out, EMBEDDING_DIM);
  console.log(`Wrote ${texts.length}*${EMBEDDING_DIM} float32 → ${outPath}`);
}

async function main() {
  const chunksPath = dataPath('chunks.jsonl');
  const embPath = dataPath('embeddings.f32');

  if (!FORCE_CPU && (await pythonAvailable())) {
    await embedViaPython(chunksPath, embPath);
  } else {
    if (FORCE_CPU) console.log('CPU=1 set → forcing Node CPU embedding');
    else console.log('Python venv not found → falling back to Node CPU');
    await embedViaNode(chunksPath, embPath);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
