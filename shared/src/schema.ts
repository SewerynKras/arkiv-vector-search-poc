// Wire-level schema shared between indexer and client.
// On-chain entity layout is documented in CLAUDE.md §5.

export const MANIFEST_VERSION = 1 as const;

export interface Manifest {
  version: typeof MANIFEST_VERSION;
  dim: number;
  C: number;
  M: number;
  nprobe_default: number;
  model_id: string;
  model_url: string;
  model_sha256: string;
  centroid_set_id: string;
  centroid_set_hash: string;
  corpus_name: string;
  N_chunks: number;
  built_at: string;
}

export interface ChunkPayload {
  emb: Uint8Array;
  text: string;
  title: string;
  url: string;
  parent_doc_id: string;
}

export interface ChunkNumericAttrs {
  cell_id_0: number;
  cell_id_1: number;
  cell_id_2: number;
  chunk_index: number;
}

export interface ChunkStringAttrs {
  kind: 'chunk';
  model_id: string;
  centroid_set_id: string;
  lang: string;
  parent_doc_id: string;
}
