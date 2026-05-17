// Shared types + decoders for both the Arkiv-RPC client (live, Braga) and
// any other ApiClient implementations. The concrete client implementation
// lives in arkiv-rpc-client.ts.

import { decode as msgpackDecode } from '@msgpack/msgpack';
import type { ChunkPayload, Manifest } from './schema';

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

export function decodeChunk(e: EntityResponse): ChunkPayload {
  const raw = msgpackDecode(decodePayload(e.payload)) as ChunkPayload;
  // msgpack returns Buffer for binary; coerce to Uint8Array.
  return {
    ...raw,
    emb: new Uint8Array(raw.emb.buffer, raw.emb.byteOffset, raw.emb.byteLength),
  };
}

export function decodeCentroidPayload(e: EntityResponse, dim: number): Float32Array {
  const bytes = decodePayload(e.payload);
  if (bytes.byteLength !== dim * 4) {
    throw new Error(`centroid payload size ${bytes.byteLength} != ${dim * 4}`);
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

// Build the IVF disjunction predicate over cell_id_0..cell_id_{M-1}.
export function buildIvfPredicate(probedCells: number[], M: number): string {
  const terms: string[] = [];
  for (let m = 0; m < M; m++) {
    for (const c of probedCells) terms.push(`cell_id_${m} = ${c}`);
  }
  return `(${terms.join(' || ')})`;
}
