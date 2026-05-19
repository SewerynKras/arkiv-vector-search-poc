// Shared types + decoders for any ApiClient implementation (concrete one
// lives in arkiv-rpc-client.ts).

import { decode as msgpackDecode } from '@msgpack/msgpack';
import type { ChunkBucketPayload, ChunkMini, Manifest } from './schema';

export interface EntityResponse {
  key: string;
  contentType: string;
  payload: string; // base64
  owner: string;
  creator: string;
  createdAt: number;
  expiresAt: number | null;
  stringAttributes: Record<string, string>;
  numericAttributes: Record<string, number>;
}

export interface PageResponse {
  entities: EntityResponse[];
  nextPageToken: string | null;
  pageSize: number;
}

export interface ApiClient {
  endpoint: string;
  queryPage: (q: string, pageSize: number, pageToken: string | null) => Promise<PageResponse>;
  queryAll: (q: string, opts?: { pageSize?: number; maxPages?: number }) => Promise<EntityResponse[]>;
}

export function decodePayload(b64: string): Uint8Array {
  // Portable: works in Node and the browser.
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function decodeManifest(e: EntityResponse): Manifest {
  return JSON.parse(new TextDecoder().decode(decodePayload(e.payload))) as Manifest;
}

// Decode a chunk_bucket entity into the chunk minis it carries. The
// embeddings come back as fresh Uint8Array views (msgpack hands back
// Buffer-flavored Uint8Arrays which we re-wrap for cleanliness).
export function decodeChunkBucket(e: EntityResponse): ChunkMini[] {
  const raw = msgpackDecode(decodePayload(e.payload)) as ChunkBucketPayload;
  return raw.chunks.map((c) => ({
    cid: c.cid,
    pid: c.pid,
    url: c.url,
    emb: new Uint8Array(c.emb.buffer, c.emb.byteOffset, c.emb.byteLength),
  }));
}

// Decode a centroid bucket payload into a flat Float32Array of one or more
// centroids. Each centroid is `dim` floats; the entity packs K of them
// (~80 for d=384 to stay under the 128 KB ceiling). The caller reads
// `first_cell_id` from the entity's numeric attributes to know where to
// place this batch in the flat C*dim buffer.
export function decodeCentroidBatch(e: EntityResponse, dim: number): Float32Array {
  const bytes = decodePayload(e.payload);
  const bytesPerVec = dim * 4;
  if (bytes.byteLength === 0 || bytes.byteLength % bytesPerVec !== 0) {
    throw new Error(
      `centroid payload size ${bytes.byteLength} not a positive multiple of ${bytesPerVec}`,
    );
  }
  // Copy into an aligned buffer.
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return new Float32Array(ab);
}

// Quote a string literal for the DSL.
export function dslString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// Build the IVF disjunction predicate over `cell_id`. In v2 each chunk's
// multi-assignment is realized by storing it in M buckets (one per assigned
// cell), so the query is a flat OR over a single attribute — no _0/_1/_2
// fan-out, no M-multiplier on the term count.
export function buildIvfPredicate(probedCells: number[]): string {
  if (probedCells.length === 0) return '(cell_id < 0)'; // matches nothing
  return `(${probedCells.map((c) => `cell_id = ${c}`).join(' || ')})`;
}
