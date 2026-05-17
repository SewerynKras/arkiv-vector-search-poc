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

First load downloads the bge-small ONNX model (~33 MB) and 2 048 centroid
entities from Arkiv (~3 s on a fast connection);

## Indexer pipeline

Each step writes to `indexer/data/` and is independently re-runnable. Run
from the repo root.

### 1. Fetch dataset — `pnpm fetch`

Pulls Wikipedia articles via the Python sidecar
(`indexer/python/fetch_dataset.py`) from a single HuggingFace parquet shard.
We bypass the HF datasets-server HTTP API because it rate-limits past a few
thousand requests.

```
ARTICLES=30000 MIN_LENGTH=500 SEED=42 pnpm fetch
```

→ `indexer/data/raw_articles.jsonl`. Requires `indexer/python/.venv` with
`datasets` + `pyarrow`.

### 2. Chunk — `pnpm chunk`

Splits articles into ~200–1500-char paragraphs; very long paragraphs get
sentence-sliced. No embedding here — the slow step (3) is kept isolated so
it can be dispatched to GPU separately.

```
CHUNKS=100000 pnpm chunk
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
C=2048 MAX_ITER=25 pnpm centroids
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
NPROBE=8 QUERIES=100 pnpm eval
```

### 7. Publish to Arkiv — `pnpm publish:arkiv`

Writes the manifest entity (1), centroid entities (C), and chunk entities
(N) to Braga via `mutateEntities` in batches. Reads the indexer wallet's
`PRIVATE_KEY` from project-root `.env`. ~30 min wall-clock for a 96 k-chunk
index on the default batch size.

```
pnpm publish:arkiv                              # full corpus
DRY_RUN=1 pnpm publish:arkiv                    # print plan, no tx
PHASES=manifest,centroids,chunks pnpm publish:arkiv   # subset of phases (recover from a partial run)
START_INDEX=50000 PHASES=chunks pnpm publish:arkiv    # resume mid-flight
```

## Maintenance scripts

| Command                | Purpose                                                                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm cleanup:arkiv`   | Find duplicate entities under our scope, keep the oldest, delete the rest. Required if a publish run is repeated. `KIND=centroid\|chunk\|manifest`. |
| `pnpm update-manifest` | Patch fields on the existing manifest entity in place (e.g. `nprobe_default`). Dry-run by default; pass `CONFIRM=1` to apply.                       |
| `pnpm smoke:arkiv`     | Smoke-test bootstrap: fetch manifest, verify centroid hash, decode a chunk.                                                                         |


## Configuration

Project root `.env`

```
PRIVATE_KEY=0x…   # indexer wallet on Braga; only the publish/cleanup/update scripts need this
```

`client/.env.local` exposes one optional knob:

```
NEXT_PUBLIC_CENTROID_SET_ID=ivf-v1   # point the browser at a different IVF set
```
