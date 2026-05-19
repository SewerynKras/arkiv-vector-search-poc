// Publish an Arkiv subset (or the full corpus) to Braga via mutateEntities.
//
//   pnpm run publish:arkiv                 # publishes everything in arkiv-subset/
//   FULL=1 pnpm run publish:arkiv          # publishes the full indexer/data/ corpus
//   DRY_RUN=1 pnpm run publish:arkiv       # dump entity counts, no tx
//   TX_BYTE_BUDGET=153600 pnpm run publish:arkiv  # raw payload bytes per tx (default 184320 = 180 KB)
//   START_INDEX=0 pnpm run publish:arkiv   # resume the chunk phase from this entity offset
//   PHASES=chunks pnpm …                   # publish only some phases
//
// v2 schema: bucketed chunks + turboquant-wasm embeddings. The rotation
// matrix is reconstructed deterministically on the client from `tq_seed`
// and `tq_dim` — nothing rotation-related is shipped on chain.

import { createWalletClient, http, WalletClient } from "@arkiv-network/sdk";
import { privateKeyToAccount } from "@arkiv-network/sdk/accounts";
import { braga } from "@arkiv-network/sdk/chains";
import { ExpirationTime } from "@arkiv-network/sdk/utils";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { encode as msgpackEncode } from "@msgpack/msgpack";

import { EMBEDDING_DIM, MODEL_ID } from "@arkiv-search/shared/embedding";
import { TurboQuant, nextPow2 } from "@arkiv-search/shared/quantize";
import {
  PROJECT_ATTRIBUTE,
  PROTOCOL_ATTRIBUTE,
  DEFAULT_EXPIRATION_DAYS,
  BRAGA_EXPLORER_URL,
} from "@arkiv-search/shared/arkiv";
import type { ChunkMini, Manifest } from "@arkiv-search/shared/schema";

import { readFloat32Matrix, readInt16Buffer, readJsonlAll } from "./lib/io.js";
import { indexerData, locateModelFile, sha256, fileSize } from "./lib/paths.js";

const FULL = process.env.FULL === "1";
const SUBSET_DIR = FULL ? indexerData("") : indexerData("arkiv-subset");
const CENTROID_SET_ID =
  process.env.CENTROID_SET_ID ?? (FULL ? "ivf-v2" : "ivf-subset-v2");
const CORPUS_NAME =
  process.env.CORPUS_NAME ??
  (FULL ? "wikipedia-simple-20231101" : "wikipedia-simple-20231101-subset");
// Per-mutateEntities byte budget. Each tx packs entities until summed
// payload would exceed this — so the 120 KB chunk buckets ship alone, the
// 30 KB ones batch 5 at a time, all without halving. Empirical Arkiv RPC
// limit lives somewhere between 150 KB and 250 KB raw payload.
const TX_BYTE_BUDGET = Number(process.env.TX_BYTE_BUDGET ?? 180 * 1024);
// Belt-and-suspenders cap so tiny entities (the manifest) don't pile into
// a single mega-tx. Rarely the binding constraint.
const MAX_ENTITIES_PER_TX = Number(process.env.MAX_ENTITIES_PER_TX ?? 100);
const START_INDEX = Number(process.env.START_INDEX ?? 0);
const EXP_DAYS = Number(process.env.EXP_DAYS ?? DEFAULT_EXPIRATION_DAYS);
const DRY_RUN = process.env.DRY_RUN === "1";
const PHASES = (process.env.PHASES ?? "manifest,centroids,chunks")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Raw payload byte budget per entity. Arkiv's hard ceiling is 128 KB; we
// pack to ≤120 KB to leave headroom for attributes + the JSON-RPC envelope
// (base64 inflates payload bytes by 33% on the wire).
const PAYLOAD_BUDGET = 120 * 1024;

// K fixed centroids per bucket. K * dim * 4 = 80 * 384 * 4 = 122,880 bytes —
// just under the budget. C / K → number of centroid bucket entities.
const CENTROIDS_PER_BUCKET = 80;

// Seed for TurboQuant's internal rotation. Changing this requires
// republishing every centroid set that uses it. Stored in the manifest so
// the client picks up the same value automatically.
const TQ_SEED = Number(process.env.TQ_SEED ?? 0xa17ad17a);

interface ChunkRow {
  chunk_index: number;
  parent_doc_id: string;
  title: string;
  url: string;
  text: string;
}

interface PreparedEntity {
  payload: Uint8Array;
  contentType: string;
  attributes: (
    | { key: string; value: string }
    | { key: string; value: number }
  )[];
  expiresIn: number;
}

function sha256Bytes(bytes: ArrayBufferView): string {
  return createHash("sha256")
    .update(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    .digest("hex");
}

function subsetPath(rel: string): string {
  return SUBSET_DIR === "" || SUBSET_DIR.endsWith("/")
    ? `${SUBSET_DIR}${rel}`
    : `${SUBSET_DIR}/${rel}`;
}

async function loadArtifacts() {
  const chunks = await readJsonlAll<ChunkRow>(subsetPath("chunks.jsonl"));
  const embeddings = await readFloat32Matrix(
    subsetPath("embeddings.f32"),
    EMBEDDING_DIM,
  );
  const centroidsFlat = await readFloat32Matrix(
    subsetPath("centroids.f32"),
    EMBEDDING_DIM,
  );
  const meta = JSON.parse(
    await readFile(subsetPath("assignments.json"), "utf8"),
  ) as { N: number; M: number; C: number };
  const cells = await readInt16Buffer(subsetPath("assignments.bin"));
  const N = embeddings.length / EMBEDDING_DIM;
  const C = centroidsFlat.length / EMBEDDING_DIM;
  if (chunks.length !== N)
    throw new Error(`chunks ${chunks.length} != embeddings ${N}`);
  if (cells.length !== N * meta.M)
    throw new Error(`cells ${cells.length} != N*M ${N * meta.M}`);
  return { chunks, embeddings, centroidsFlat, cells, N, C, M: meta.M };
}

async function buildManifest(
  N: number,
  C: number,
  M: number,
  centroidSetHash: string,
  tqDim: number,
  embByteSize: number,
): Promise<Manifest> {
  const modelPath = locateModelFile();
  const modelSha = await sha256(modelPath);
  await stat(modelPath);
  return {
    version: 2,
    dim: EMBEDDING_DIM,
    C,
    M,
    // At C=16384 / nprobe=8 we probe 0.05% of the cell space. Run eval-recall
    // against the new corpus before bumping this — anything above ~32 risks
    // pagination truncation when cell sizes are skewed.
    nprobe_default: 8,
    model_id: MODEL_ID,
    model_url: `https://huggingface.co/${MODEL_ID}/resolve/main/onnx/model_quantized.onnx`,
    model_sha256: modelSha,
    centroid_set_id: CENTROID_SET_ID,
    centroid_set_hash: centroidSetHash,
    emb_quant: "tq-wasm",
    emb_byte_size: embByteSize,
    tq_dim: tqDim,
    tq_seed: TQ_SEED,
    corpus_name: CORPUS_NAME,
    N_chunks: N,
    built_at: new Date().toISOString(),
  };
}

function manifestEntity(manifest: Manifest, expiresIn: number): PreparedEntity {
  return {
    payload: new TextEncoder().encode(JSON.stringify(manifest)),
    contentType: "application/json",
    attributes: [
      PROJECT_ATTRIBUTE,
      PROTOCOL_ATTRIBUTE,
      { key: "kind", value: "manifest" },
      { key: "model_id", value: MODEL_ID },
      { key: "centroid_set_id", value: CENTROID_SET_ID },
    ],
    expiresIn,
  };
}

function centroidEntities(
  centroidsFlat: Float32Array,
  C: number,
  centroidSetHash: string,
  expiresIn: number,
): PreparedEntity[] {
  const K = CENTROIDS_PER_BUCKET;
  const out: PreparedEntity[] = [];
  for (let baseCell = 0, batchId = 0; baseCell < C; batchId++, baseCell += K) {
    const end = Math.min(baseCell + K, C);
    const slice = centroidsFlat.slice(
      baseCell * EMBEDDING_DIM,
      end * EMBEDDING_DIM,
    );
    const payload = new Uint8Array(
      slice.buffer,
      slice.byteOffset,
      slice.byteLength,
    );
    out.push({
      payload,
      contentType: "application/octet-stream",
      attributes: [
        PROJECT_ATTRIBUTE,
        PROTOCOL_ATTRIBUTE,
        { key: "kind", value: "centroid" },
        { key: "model_id", value: MODEL_ID },
        { key: "centroid_set_id", value: CENTROID_SET_ID },
        { key: "centroid_set_hash", value: centroidSetHash },
        { key: "batch_id", value: batchId },
        { key: "first_cell_id", value: baseCell },
      ],
      expiresIn,
    });
  }
  return out;
}

// Encode every chunk embedding through turboquant-wasm and bucket them by
// cell. Each chunk is replicated into M cells (its multi-assignment). Each
// bucket entity carries ≤ PAYLOAD_BUDGET bytes of msgpacked chunk minis.
async function chunkBucketEntities(
  chunks: ChunkRow[],
  embeddings: Float32Array,
  cells: Int16Array,
  tq: TurboQuant,
  tqDim: number,
  N: number,
  M: number,
  expiresIn: number,
): Promise<{ entities: PreparedEntity[]; embByteSize: number }> {
  const dim = EMBEDDING_DIM;
  console.log(`  encoding ${N} embeddings through TurboQuant…`);
  const t0 = Date.now();
  const minis: ChunkMini[] = new Array(N);
  // Reusable padded buffer — avoid allocating N × tqDim floats.
  const padBuf = new Float32Array(tqDim);
  let embByteSize = 0;
  for (let i = 0; i < N; i++) {
    const emb = embeddings.subarray(i * dim, (i + 1) * dim);
    // Zero-tail pad from dim → tqDim. We zero the buffer once and only
    // overwrite the first `dim` floats each iteration since indexes
    // [dim, tqDim) stay 0.
    padBuf.set(emb);
    const encoded = tq.encode(padBuf);
    // The WASM library reuses an internal output buffer across calls and
    // hands us back a view. Copy each encoding so the next call doesn't
    // overwrite the bytes we just stored.
    const owned = new Uint8Array(encoded.byteLength);
    owned.set(encoded);
    if (embByteSize === 0) embByteSize = owned.byteLength;
    else if (owned.byteLength !== embByteSize)
      throw new Error(
        `inconsistent encode size at i=${i}: ${owned.byteLength} != ${embByteSize}`,
      );

    const row = chunks[i]!;
    minis[i] = {
      cid: i,
      emb: owned,
      pid: row.parent_doc_id,
      url: row.url,
    };
    if (i % 50000 === 0 && i > 0) {
      const rate = i / ((Date.now() - t0) / 1000);
      console.log(`    ${i}/${N}  ${rate.toFixed(0)}/s`);
    }
  }
  console.log(
    `  done (${((Date.now() - t0) / 1000).toFixed(1)}s, ${embByteSize}B per encoded vec)`,
  );

  // Group minis by cell.
  const byCell = new Map<number, ChunkMini[]>();
  for (let i = 0; i < N; i++) {
    for (let m = 0; m < M; m++) {
      const c = cells[i * M + m]!;
      if (c < 0) continue;
      let arr = byCell.get(c);
      if (!arr) {
        arr = [];
        byCell.set(c, arr);
      }
      arr.push(minis[i]!);
    }
  }

  // Pre-encode each mini once to know its byte size for the greedy pack.
  const sizeOf = new Map<ChunkMini, number>();
  for (const arr of byCell.values()) {
    for (const m of arr) {
      if (!sizeOf.has(m)) sizeOf.set(m, msgpackEncode(m).length);
    }
  }

  const out: PreparedEntity[] = [];
  const HEADER = 16; // headroom for { chunks: [...] } shell up to array len < 2^16
  let maxBucketBytes = 0;
  let totalMinis = 0;

  for (const [cellId, cellMinis] of byCell) {
    let bucketIndex = 0;
    let curr: ChunkMini[] = [];
    let currSize = HEADER;
    const flush = () => {
      if (curr.length === 0) return;
      const payload = msgpackEncode({ chunks: curr });
      if (payload.length > 128 * 1024) {
        throw new Error(
          `chunk bucket cell=${cellId} idx=${bucketIndex} = ${payload.length}B exceeds 128 KB`,
        );
      }
      if (payload.length > maxBucketBytes) maxBucketBytes = payload.length;
      out.push({
        payload,
        contentType: "application/x-arkiv-chunk-bucket-v2",
        attributes: [
          PROJECT_ATTRIBUTE,
          PROTOCOL_ATTRIBUTE,
          { key: "kind", value: "chunk_bucket" },
          { key: "model_id", value: MODEL_ID },
          { key: "centroid_set_id", value: CENTROID_SET_ID },
          { key: "cell_id", value: cellId },
          { key: "bucket_index", value: bucketIndex },
        ],
        expiresIn,
      });
      bucketIndex++;
      totalMinis += curr.length;
      curr = [];
      currSize = HEADER;
    };
    for (const m of cellMinis) {
      const sz = sizeOf.get(m)!;
      if (curr.length > 0 && currSize + sz > PAYLOAD_BUDGET) flush();
      curr.push(m);
      currSize += sz;
    }
    flush();
  }

  // Sort buckets by payload size ascending. Byte-batched publishing pairs
  // entities greedily until the next would exceed budget — with size-sorted
  // input, small ones cluster up front (pack 3-5 per tx), big ones bunch at
  // the tail (single-entity txs). Without the sort, a chain like
  // [50K, 90K, 50K, 90K] would single-ship every entity even though
  // [50K, 50K] and [90K] would have packed efficiently.
  out.sort((a, b) => a.payload.byteLength - b.payload.byteLength);

  console.log(
    `  packed ${totalMinis} chunk replicas into ${out.length} buckets ` +
      `(max payload ${(maxBucketBytes / 1024).toFixed(1)} KB, sorted by size)`,
  );
  return { entities: out, embByteSize };
}

interface PublishOptions {
  startIndex?: number;
}

// Byte-budget batched publish. Walks the entity list packing into each tx
// until the next entity would push raw-payload bytes over `budget`. On a
// failure, halves the budget and retries. Single-entity sends that fail are
// fatal — that entity simply doesn't fit on the RPC.
//
// Wins over count-based batching when payload sizes vary (e.g., chunk
// buckets at 30–120 KB): the 30 KB ones still batch tight while the 120 KB
// ones ship solo, in a single pass with no halving search.
async function publishByteBatched(
  walletClient: ReturnType<typeof createWalletClient>,
  entities: PreparedEntity[],
  label: string,
  opts: PublishOptions = {},
): Promise<void> {
  const startIndex = opts.startIndex ?? 0;
  let cursor = startIndex;
  let budget = TX_BYTE_BUDGET;
  const t0 = Date.now();
  while (cursor < entities.length) {
    // Greedily pack entities into this tx by summed raw payload bytes,
    // capped at MAX_ENTITIES_PER_TX as a safety belt.
    let end = cursor + 1;
    let bytes = entities[cursor]!.payload.byteLength;
    while (end < entities.length && end - cursor < MAX_ENTITIES_PER_TX) {
      const next = entities[end]!.payload.byteLength;
      if (bytes + next > budget) break;
      bytes += next;
      end++;
    }
    const slice = entities.slice(cursor, end);
    try {
      const result = await walletClient.mutateEntities({ creates: slice });
      cursor = end;
      const txHash = (result as { txHash?: string }).txHash;
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      const rate =
        (cursor - startIndex) / Math.max((Date.now() - t0) / 1000, 0.001);
      const remaining = entities.length - cursor;
      const etaSec = remaining > 0 ? remaining / rate : 0;
      const eta =
        etaSec > 60
          ? `${(etaSec / 60).toFixed(1)}min`
          : `${etaSec.toFixed(0)}s`;
      console.log(
        `  [${label}] ${cursor}/${entities.length}  batch=${slice.length} ` +
          `(${(bytes / 1024).toFixed(0)}KB)  ${elapsed}s  ${rate.toFixed(0)}/s  eta=${eta}` +
          (txHash ? `  tx=${txHash.slice(0, 14)}…` : ""),
      );
    } catch (e) {
      const msg = (e as Error).message;
      if (slice.length === 1) {
        throw new Error(
          `[${label}] single-entity tx failed at cursor ${cursor} (${(bytes / 1024).toFixed(0)}KB): ${msg}`,
        );
      }
      const halved = Math.max(1024, Math.floor(budget / 2));
      console.warn(
        `  [${label}] batch=${slice.length} (${(bytes / 1024).toFixed(0)}KB) failed: ${msg.split("\n")[0]}`,
      );
      console.warn(
        `  [${label}] dropping byte budget ${(budget / 1024).toFixed(0)}KB → ${(halved / 1024).toFixed(0)}KB`,
      );
      budget = halved;
    }
  }
}

async function main() {
  if (!DRY_RUN && !process.env.PRIVATE_KEY) {
    throw new Error(
      "PRIVATE_KEY not set. Run with tsx --env-file=.env, or set it in the shell.",
    );
  }

  const { chunks, embeddings, centroidsFlat, cells, N, C, M } =
    await loadArtifacts();
  const centroidSetHash = sha256Bytes(centroidsFlat);

  // We pad embeddings to the next power of 2 before encoding because
  // turboquant-wasm's WASM kernels only accept power-of-2 dimensions.
  const tqDim = nextPow2(EMBEDDING_DIM);
  console.log(
    `Initialising TurboQuant (dim=${tqDim}, padded from ${EMBEDDING_DIM}, seed=0x${TQ_SEED.toString(16)})…`,
  );
  const tq = await TurboQuant.init({ dim: tqDim, seed: TQ_SEED });

  // Padded probe to learn the encoded byte size before we publish anything.
  const probeBuf = new Float32Array(tqDim);
  probeBuf.set(embeddings.subarray(0, EMBEDDING_DIM));
  const _probe = tq.encode(probeBuf);
  const probeBytes = _probe.byteLength;

  const expiresIn = ExpirationTime.fromDays(EXP_DAYS);

  console.log(`Source dir: ${SUBSET_DIR}`);
  console.log(
    `Corpus stats: N=${N} C=${C} M=${M} dim=${EMBEDDING_DIM} tq_dim=${tqDim} emb_bytes=${probeBytes}`,
  );
  console.log(
    `Project:      ${PROJECT_ATTRIBUTE.key}="${PROJECT_ATTRIBUTE.value}"`,
  );
  console.log(
    `Centroid set: ${CENTROID_SET_ID} (hash ${centroidSetHash.slice(0, 16)}…)`,
  );
  console.log(`Expiration:   ${EXP_DAYS} days (${expiresIn}s)`);

  let chBucketEntities: PreparedEntity[] = [];
  let embByteSize = probeBytes;
  if (PHASES.includes("chunks")) {
    const r = await chunkBucketEntities(
      chunks,
      embeddings,
      cells,
      tq,
      tqDim,
      N,
      M,
      expiresIn,
    );
    chBucketEntities = r.entities;
    embByteSize = r.embByteSize;
  }

  // Build manifest after we know the encoded byte size (whether from a
  // full chunk-phase run or just the probe encoding).
  const manifest = await buildManifest(
    N,
    C,
    M,
    centroidSetHash,
    tqDim,
    embByteSize,
  );
  const manEntity = manifestEntity(manifest, expiresIn);
  const cEntities = centroidEntities(
    centroidsFlat,
    C,
    centroidSetHash,
    expiresIn,
  );

  const total = 1 + cEntities.length + chBucketEntities.length;
  console.log(
    `Total entities: ${total} (1 manifest + ${cEntities.length} centroid buckets + ${chBucketEntities.length} chunk buckets)`,
  );
  console.log(
    `Batch sizing:   ≤${(TX_BYTE_BUDGET / 1024).toFixed(0)}KB raw payload per tx (≤${MAX_ENTITIES_PER_TX} entities), byte-budget halves on failure`,
  );
  if (START_INDEX > 0)
    console.log(
      `Resuming chunks from index ${START_INDEX} (${chBucketEntities.length - START_INDEX} remaining)`,
    );

  if (DRY_RUN) {
    console.log(`\nDRY_RUN=1 — not submitting.`);
    tq.destroy();
    return;
  }

  console.log(
    `\nModel file: ${locateModelFile()} (${fileSize(locateModelFile())} bytes, sha256 ${manifest.model_sha256.slice(0, 16)}…)`,
  );

  const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
  console.log(`Wallet: ${account.address}  →  Braga (${braga.id})`);
  console.log(`Explorer: ${BRAGA_EXPLORER_URL}/address/${account.address}`);

  const walletClient = createWalletClient({
    chain: braga,
    transport: http(),
    account,
  });

  console.log(`Phases to run: ${PHASES.join(", ")}`);
  if (PHASES.includes("manifest")) {
    console.log(`\n[manifest] Publishing 1 entity…`);
    await publishByteBatched(walletClient, [manEntity], "manifest");
  }
  if (PHASES.includes("centroids")) {
    console.log(`\n[centroids] Publishing ${cEntities.length} entities…`);
    await publishByteBatched(walletClient, cEntities, "centroid");
  }
  if (PHASES.includes("chunks")) {
    const remaining = chBucketEntities.length - START_INDEX;
    console.log(
      `\n[chunks] Publishing ${remaining} bucket entities (starting at ${START_INDEX})…`,
    );
    await publishByteBatched(walletClient, chBucketEntities, "chunk", {
      startIndex: START_INDEX,
    });
  }

  console.log(`\nDone.`);
  console.log(
    `Check explorer: ${BRAGA_EXPLORER_URL}/address/${account.address}`,
  );
  tq.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
