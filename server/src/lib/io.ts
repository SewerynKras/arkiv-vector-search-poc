import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';

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

export async function readFloat32Matrix(path: string, dim: number): Promise<Float32Array> {
  const buf = await readFile(path);
  if (buf.byteLength % (dim * 4) !== 0) {
    throw new Error(`file size ${buf.byteLength} not divisible by row size ${dim * 4}`);
  }
  const u8 = new Uint8Array(buf.byteLength);
  u8.set(buf);
  return new Float32Array(u8.buffer);
}

export async function readInt16Buffer(path: string): Promise<Int16Array> {
  const buf = await readFile(path);
  const u8 = new Uint8Array(buf.byteLength);
  u8.set(buf);
  return new Int16Array(u8.buffer);
}
