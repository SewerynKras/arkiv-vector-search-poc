# Arkiv Search

Permissionless semantic search over Wikipedia, end-to-end on
[Arkiv](https://docs.arkiv.network/). The corpus, embeddings, and IVF index
live on the Arkiv testnet (Braga); the query client runs entirely in the
browser. There is no backend in the request path — anyone with the Arkiv
RPC URL and the `model_id` / `centroid_set_id` can run the exact same
queries, no cooperation from us required.

## Repo layout

```
shared/    cross-cutting code (search driver, Arkiv RPC client, embedding loader)
indexer/   offline pipeline that produces the IVF index from a Wikipedia dump
server/    publish + maintenance scripts (write side only — there is no query server)
client/    Next.js 16 static site, the UI everyone hits
```

## Run the client

```sh
pnpm install
pnpm dev
```

On a cold first load the client fetches:

- the bge-small ONNX model from R2 (~33 MB; cached by the browser),
- the manifest entity,
- the packed centroid-bucket entities from Arkiv (`ivf-v3` ≈ 103 buckets at
  C=8192, K=80 centroids per entity; cached in IndexedDB by
  `centroid_set_hash`),
- the turboquant-wasm engine (embedded in the JS bundle).

## What's IVF?

**Inverted-file index.** Partition the embedding space into `C` clusters
via k-means, then file each chunk under the few clusters it sits closest
to. A query scores its vector against the `C` cluster centres, picks the
top `nprobe`, and only reranks the chunks filed there — so we avoid
brute-forcing every embedding in the corpus.

The on-chain query is a flat OR over `nprobe` equalities on a
single `cell_id` attribute, AND-ed with the project / protocol /
`$creator` scope. Multi-assignment is realised by storing each chunk in
M=3 chunk-bucket entities (one per assigned cell), so the query stays
simple.

## On-chain architecture

The index is *bucketed* on chain to keep RPC round-trips down at scale:

- **Manifest** (1 entity) — small JSON record: `N_chunks`, `C`, `M`,
  `nprobe_default`, model SHA, centroid-set hash, and the TurboQuant
  config (`tq_dim`, `tq_seed`, `emb_byte_size`).
- **Centroid buckets** (~`C/80` entities, `kind="centroid"`) — each entity
  packs K=80 float32 centroids, attribute `first_cell_id` tells the
  client where the batch lands. At C=8192 (current `ivf-v3`) this is 103
  entities.
- **Chunk buckets** (~thousands, `kind="chunk_bucket"`) — each entity
  carries many chunks (msgpacked) that all belong to the same cell. Each
  chunk is `{ cid, emb, pid, url }`; no raw text. Title and extract are
  fetched from the public Wikipedia REST summary API at result-display
  time.

Chunk embeddings use **turboquant-wasm** (Google's TurboQuant algorithm,
Zig → WASM + relaxed SIMD): ~3 bits/dim → ~320 B per vector at d=384
(zero-padded to d=512, since the WASM kernel requires a power of 2). The
rotation matrix is reconstructed deterministically on both publisher and
client from `tq_seed` — nothing rotation-related is shipped on chain.
Rerank uses `tq.dotBatch()` for one WASM/WebGPU call over the whole
candidate set, instead of per-chunk JS↔WASM crossings.

## Indexer pipeline

Each step writes to `indexer/data/` and is independently re-runnable. Run
from the repo root.

### 1. Fetch dataset — `pnpm fetch`

Pulls Wikipedia articles via the Python sidecar
(`indexer/python/fetch_dataset.py`) from a single HuggingFace parquet shard.
We bypass the HF datasets-server HTTP API because it rate-limits past a few
thousand requests.

```
ARTICLES=100000 MIN_LENGTH=500 SEED=42 pnpm run fetch
```

(`pnpm fetch` without `run` collides with pnpm's built-in lockfile-fetch command and silently does nothing.)

→ `indexer/data/raw_articles.jsonl`. Requires `indexer/python/.venv` with
`datasets` + `pyarrow`.

### 2. Chunk — `pnpm chunk`

Splits articles into ~200–1500-char paragraphs; very long paragraphs get
sentence-sliced. No embedding here — the slow step (3) is kept isolated so
it can be dispatched to GPU separately.

```
CHUNKS=400000 pnpm chunk
```

→ `indexer/data/chunks.jsonl`.

### 3. Embed — `pnpm embed`

Embeds every chunk with **bge-small-en-v1.5** (384-dim, mean-pool with
attention mask, then L2-normalize). Two backends:

- **GPU (default)** — shells out to `indexer/python/embed_gpu.py` (PyTorch
  + CUDA). ~250 chunks/s on a GTX 1060.
- **CPU fallback** — `CPU=1 pnpm embed` uses the same INT8 ONNX path the
  browser runs. ~13 chunks/s on Node CPU.

Output: packed Float32 matrix at `indexer/data/embeddings.f32` (N × 384).
Cosine between the GPU FP32 path and browser INT8 path is ≈ 0.997 — close
enough that we don't see ranking drift.

### 4. Train centroids — `pnpm centroids`

Spherical k-means on the embeddings (`indexer/src/lib/kmeans.ts`). Spherical
because everything is L2-normalised, so cosine = dot product.

```
C=8192 MAX_ITER=25 pnpm centroids
```

→ `indexer/data/centroids.f32` (C × 384).

### 5. Assign cells — `pnpm assign`

For each chunk, find its top-M nearest centroids via `faiss-node`. **M=3
multi-assignment** means a chunk lands in three cells, letting the query
stage probe fewer cells and still find it.

```
M=3 pnpm assign
```

→ `indexer/data/assignments.bin` (int16 × N × M) + `assignments.json` (meta).

### 6. Eval recall — `pnpm eval`

Sanity check before publishing: 100 random chunks as queries, IVF top-10
(at the chosen `nprobe`) vs brute-force exact KNN over the full corpus. We
gate publishing on recall@10 ≥ 0.90.

```
NPROBE=16 QUERIES=100 pnpm eval
```

### 7. Publish to Arkiv — `pnpm publish:arkiv`

Encodes every chunk through TurboQuant, buckets chunks by cell, then writes
manifest + centroid buckets + chunk buckets to Braga via `mutateEntities`.
Reads the indexer wallet's `PRIVATE_KEY` from project-root `.env`. The
publisher uses byte-budget batching (default 180 KB raw payload per tx)
and sorts chunk buckets by size so small ones pack densely and large ones
ship solo.

```
pnpm publish:arkiv                                  # full corpus
DRY_RUN=1 pnpm publish:arkiv                        # print plan, no tx
PHASES=manifest,centroids,chunks pnpm publish:arkiv # subset of phases (recover from a partial run)
START_INDEX=1500 PHASES=chunks pnpm publish:arkiv   # resume mid-flight
TX_BYTE_BUDGET=131072 pnpm publish:arkiv            # tighten the per-tx byte budget
```

## Maintenance scripts

| Command                | Purpose                                                                                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm cleanup:arkiv`   | Find duplicate entities under our scope (always scoped by `centroid_set_id`), keep the oldest, delete the rest. `KIND=centroid\|chunk_bucket\|manifest`. Dry-run by default. |
| `pnpm update-manifest` | Patch `nprobe_default` on the existing manifest entity in place. Dry-run by default; pass `CONFIRM=1` to apply.                                                              |
| `pnpm smoke:arkiv`     | Bootstrap from Arkiv (manifest + centroids + TurboQuant init), run one search, print the top articles. No browser needed.                                                    |

## Configuration

Project root `.env`

```
PRIVATE_KEY=0x…   # indexer wallet on Braga; only the publish/cleanup/update scripts need this
```

`client/.env.local` exposes one optional knob:

```
NEXT_PUBLIC_CENTROID_SET_ID=ivf-v3   # point the browser at a different IVF set (default: ivf-v3)
```
