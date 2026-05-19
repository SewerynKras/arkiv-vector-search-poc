// Wire-level schema shared between indexer and client.
// On-chain entity layout is documented in CLAUDE.md §5.
//
// MANIFEST_VERSION = 2 introduces:
//   - Chunk buckets (`kind="chunk_bucket"`): one entity carries many chunks,
//     all assigned to the same cell. Raw text is no longer stored; the
//     client fetches title/extract from the Wikipedia summary API at
//     display time.
//   - Centroid buckets packed at K=80 per entity (`kind="centroid"`,
//     `batch_id` + `first_cell_id` attributes).
//   - turboquant-wasm chunk embeddings (~3 bits/dim, ~320 B per vector at
//     zero-padded dim=512). The rotation matrix lives nowhere on chain —
//     it's reconstructed deterministically from `tq_seed` by
//     `TurboQuant.init` on both publisher and client.

export const MANIFEST_VERSION = 2 as const;

export interface Manifest {
  version: typeof MANIFEST_VERSION;
  /** Model embedding dimension (e.g., 384 for bge-small). */
  dim: number;
  C: number;
  M: number;
  nprobe_default: number;

  model_id: string;
  model_url: string;
  model_sha256: string;

  centroid_set_id: string;
  centroid_set_hash: string;

  /** Quantization scheme. "tq-wasm" = turboquant-wasm (3 bits/dim
   * polar + QJL, with internal Hadamard rotation). */
  emb_quant: "tq-wasm";
  /** Bytes per encoded chunk embedding, as returned by `tq.encode()` for
   * the configured (tq_dim, tq_seed). The client validates this on decode. */
  emb_byte_size: number;
  /** Vector dimension passed to `TurboQuant.init` — the model `dim` rounded
   * up to the next power of 2 (e.g., 512 for d=384). Each embedding is
   * zero-padded from `dim` to `tq_dim` before encode; queries are padded
   * identically before `tq.dot`. */
  tq_dim: number;
  /** Deterministic seed for the WASM engine's internal rotation matrix.
   * Identical (`tq_dim`, `tq_seed`) on publisher and client → byte-exact
   * compatibility (turboquant-wasm is golden-value tested vs its
   * reference Zig implementation). */
  tq_seed: number;

  corpus_name: string;
  N_chunks: number;
  built_at: string;
}

// A single chunk inside a chunk_bucket entity. No raw text, no title —
// those are fetched from the Wikipedia summary API at display time using
// `url`.
export interface ChunkMini {
  /** Global chunk id. Used to dedupe across buckets when a chunk's
   * multi-assignment lands its replicas in multiple probed cells. */
  cid: number;
  /** turboquant-wasm-encoded embedding (length = manifest.emb_byte_size). */
  emb: Uint8Array;
  /** Parent document id from the source dataset — the grouping key for
   * "merge passages from the same article". */
  pid: string;
  /** Public link to the source article (e.g., Wikipedia URL). */
  url: string;
}

export interface ChunkBucketPayload {
  /** All chunks share the same `cell_id` attribute on the parent entity. */
  chunks: ChunkMini[];
}
