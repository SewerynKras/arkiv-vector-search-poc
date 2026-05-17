// Bulk-fetch Wikipedia articles from a single HF parquet file via the Python
// sidecar. The previous HTTP datasets-server approach gets aggressively
// rate-limited (429) past a few thousand requests.

import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { dataPath } from './lib/io.js';

const TARGET_ARTICLES = Number(process.env.ARTICLES ?? 1500);
const MIN_LENGTH = Number(process.env.MIN_LENGTH ?? 500);
const SEED = Number(process.env.SEED ?? 42);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VENV_PYTHON = path.resolve(__dirname, '../python/.venv/bin/python');
const SIDECAR = path.resolve(__dirname, '../python/fetch_dataset.py');

async function main() {
  if (!existsSync(VENV_PYTHON) || !existsSync(SIDECAR)) {
    throw new Error(
      `Python venv not found at ${VENV_PYTHON}.\n` +
      `Set up the venv first: see indexer/python/README or run\n` +
      `  cd indexer/python && uv venv .venv && uv pip install --python .venv/bin/python datasets pyarrow`,
    );
  }
  const out = dataPath('raw_articles.jsonl');
  console.log(`Fetching ${TARGET_ARTICLES} articles via Python sidecar → ${out}`);
  const args = [
    SIDECAR,
    '--out', out,
    '-n', String(TARGET_ARTICLES),
    '--min-length', String(MIN_LENGTH),
    '--seed', String(SEED),
  ];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(VENV_PYTHON, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`fetch_dataset.py exited with code ${code}`));
    });
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
