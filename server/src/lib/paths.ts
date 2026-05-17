import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// This file lives at <root>/server/src/lib/paths.ts → 4 levels up.
export const PROJECT_ROOT = resolve(fileURLToPath(import.meta.url), '../../../..');

export const INDEXER_DATA_DIR = resolve(PROJECT_ROOT, 'indexer/data');
export const SERVER_DATA_DIR = resolve(PROJECT_ROOT, 'server/data');

export function indexerData(rel: string): string {
  return resolve(INDEXER_DATA_DIR, rel);
}

export function serverData(rel: string): string {
  const p = resolve(SERVER_DATA_DIR, rel);
  if (!existsSync(SERVER_DATA_DIR)) mkdirSync(SERVER_DATA_DIR, { recursive: true });
  return p;
}

export const DEFAULT_DB_PATH = serverData('entities.sqlite');

const MODEL_REL =
  'node_modules/.pnpm/@huggingface+transformers@3.8.1/node_modules/@huggingface/transformers/.cache/Xenova/bge-small-en-v1.5/onnx/model_quantized.onnx';

export function locateModelFile(): string {
  // Walk node_modules/.pnpm to find the transformers cache. The version segment
  // can change; resolve it dynamically so we don't have to bump a constant.
  const direct = resolve(PROJECT_ROOT, MODEL_REL);
  if (existsSync(direct)) return direct;

  // Fallback: glob the .pnpm directory.
  const pnpm = resolve(PROJECT_ROOT, 'node_modules/.pnpm');
  if (!existsSync(pnpm)) throw new Error(`pnpm store not found at ${pnpm}`);
  for (const dir of readdirSync(pnpm)) {
    if (!dir.startsWith('@huggingface+transformers@')) continue;
    const cand = resolve(
      pnpm, dir,
      'node_modules/@huggingface/transformers/.cache/Xenova/bge-small-en-v1.5/onnx/model_quantized.onnx',
    );
    if (existsSync(cand)) return cand;
  }
  throw new Error('Could not locate cached bge-small-en-v1.5 ONNX file. Run an embed step first.');
}

export async function sha256(path: string): Promise<string> {
  const buf = await readFile(path);
  return createHash('sha256').update(buf).digest('hex');
}

export function fileSize(path: string): number {
  return statSync(path).size;
}
