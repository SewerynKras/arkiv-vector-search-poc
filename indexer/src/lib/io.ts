import { createWriteStream, createReadStream, mkdirSync, existsSync, statSync } from 'node:fs';
import { writeFile, readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// This file lives at <root>/indexer/src/lib/io.ts → 4 levels up.
export const PROJECT_ROOT = resolve(fileURLToPath(import.meta.url), '../../../..');
export const DATA_DIR = resolve(PROJECT_ROOT, 'indexer/data');

export function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

export function dataPath(rel: string): string {
  const p = resolve(DATA_DIR, rel);
  const dir = dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return p;
}

export async function writeJsonl<T>(path: string, rows: Iterable<T> | AsyncIterable<T>): Promise<number> {
  const stream = createWriteStream(path, { encoding: 'utf8' });
  let n = 0;
  for await (const r of rows as AsyncIterable<T>) {
    stream.write(JSON.stringify(r) + '\n');
    n++;
  }
  await new Promise<void>((res, rej) => stream.end((err?: Error) => (err ? rej(err) : res())));
  return n;
}

export async function* readJsonl<T>(path: string): AsyncGenerator<T> {
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    yield JSON.parse(line) as T;
  }
}

export async function readJsonlAll<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  for await (const r of readJsonl<T>(path)) out.push(r);
  return out;
}

export async function writeFloat32Matrix(path: string, rows: Float32Array[], dim: number): Promise<void> {
  const buf = new Float32Array(rows.length * dim);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.length !== dim) throw new Error(`row ${i}: expected dim ${dim}, got ${rows[i]!.length}`);
    buf.set(rows[i]!, i * dim);
  }
  await writeFile(path, Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength));
}

export async function readFloat32Matrix(path: string, dim: number): Promise<Float32Array> {
  const buf = await readFile(path);
  const size = buf.byteLength;
  if (size % (dim * 4) !== 0) {
    throw new Error(`file size ${size} not divisible by row size ${dim * 4}`);
  }
  // copy into an aligned buffer (Buffer's underlying ArrayBuffer may be shared)
  const u8 = new Uint8Array(size);
  u8.set(buf);
  return new Float32Array(u8.buffer);
}

export function fileExists(path: string): boolean {
  try { statSync(path); return true; } catch { return false; }
}
