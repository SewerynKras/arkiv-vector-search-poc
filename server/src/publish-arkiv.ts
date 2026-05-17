// Publish an Arkiv subset (or the full corpus) to Braga via mutateEntities.
//
//   pnpm run publish:arkiv                 # publishes everything in arkiv-subset/
//   FULL=1 pnpm run publish:arkiv          # publishes the full indexer/data/ (96k chunks, 2048 centroids)
//   DRY_RUN=1 pnpm run publish:arkiv       # dump the entities array, no tx
//   MAX_BATCH=1000 pnpm run publish:arkiv  # try this batch size first, halve on failure
//   START_INDEX=0 pnpm run publish:arkiv   # resume chunk phase from this offset
//
// Reads PRIVATE_KEY from the project-root .env (loaded via tsx --env-file).

import { createWalletClient, http } from '@arkiv-network/sdk';
import { privateKeyToAccount } from '@arkiv-network/sdk/accounts';
import { braga } from '@arkiv-network/sdk/chains';
import { ExpirationTime } from '@arkiv-network/sdk/utils';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { encode as msgpackEncode } from '@msgpack/msgpack';

import { EMBEDDING_DIM, MODEL_ID } from '@arkiv-search/shared/embedding';
import { quantizeInt8 } from '@arkiv-search/shared/quantize';
import {
  PROJECT_ATTRIBUTE,
  PROTOCOL_ATTRIBUTE,
  DEFAULT_EXPIRATION_DAYS,
  BRAGA_EXPLORER_URL,
} from '@arkiv-search/shared/arkiv';
import type { ChunkPayload, Manifest } from '@arkiv-search/shared/schema';

import { readFloat32Matrix, readInt16Buffer, readJsonlAll } from './lib/io.js';
import { indexerData, locateModelFile, sha256, fileSize } from './lib/paths.js';

const FULL = process.env.FULL === '1';
const SUBSET_DIR = FULL ? indexerData('') : indexerData('arkiv-subset');
const CENTROID_SET_ID = process.env.CENTROID_SET_ID ?? (FULL ? 'ivf-v1' : 'ivf-subset');
const CORPUS_NAME = process.env.CORPUS_NAME ?? (FULL ? 'wikipedia-simple-20231101' : 'wikipedia-simple-20231101-subset');
const MAX_BATCH = Number(process.env.MAX_BATCH ?? 1000);
const MIN_BATCH = Number(process.env.MIN_BATCH ?? 25);
const START_INDEX = Number(process.env.START_INDEX ?? 0); // chunk phase offset for resume
const EXP_DAYS = Number(process.env.EXP_DAYS ?? DEFAULT_EXPIRATION_DAYS);
const DRY_RUN = process.env.DRY_RUN === '1';
const PHASES = (process.env.PHASES ?? 'manifest,centroids,chunks')
  .split(',').map((s) => s.trim()).filter(Boolean);

interface ChunkRow { chunk_index: number; parent_doc_id: string; title: string; url: string; text: string }

/** An entity prepared for mutateEntities. */
interface PreparedEntity {
  payload: Uint8Array;
  contentType: string;
  attributes: ({ key: string; value: string } | { key: string; value: number })[];
  expiresIn: number;
}

function hashCentroids(flat: Float32Array): string {
  return createHash('sha256').update(Buffer.from(flat.buffer, flat.byteOffset, flat.byteLength)).digest('hex');
}

function subsetPath(rel: string): string {
  return SUBSET_DIR === '' || SUBSET_DIR.endsWith('/') ? `${SUBSET_DIR}${rel}` : `${SUBSET_DIR}/${rel}`;
}

async function loadArtifacts() {
  const chunks = await readJsonlAll<ChunkRow>(subsetPath('chunks.jsonl'));
  const embeddings = await readFloat32Matrix(subsetPath('embeddings.f32'), EMBEDDING_DIM);
  const centroidsFlat = await readFloat32Matrix(subsetPath('centroids.f32'), EMBEDDING_DIM);
  const meta = JSON.parse(await readFile(subsetPath('assignments.json'), 'utf8')) as { N: number; M: number; C: number };
  const cells = await readInt16Buffer(subsetPath('assignments.bin'));
  const N = embeddings.length / EMBEDDING_DIM;
  const C = centroidsFlat.length / EMBEDDING_DIM;
  if (chunks.length !== N) throw new Error(`chunks ${chunks.length} != embeddings ${N}`);
  if (cells.length !== N * meta.M) throw new Error(`cells ${cells.length} != N*M ${N * meta.M}`);
  return { chunks, embeddings, centroidsFlat, cells, N, C, M: meta.M };
}

async function buildManifest(N: number, C: number, M: number, centroidSetHash: string): Promise<Manifest> {
  const modelPath = locateModelFile();
  const modelSha = await sha256(modelPath);
  await stat(modelPath);
  return {
    version: 1,
    dim: EMBEDDING_DIM,
    C,
    M,
    // Arkiv pagination caps each query at 200 entities/page × 10 pages = 2000
    // candidates. With M=3 cell assignments per chunk and average cell size
    // N*M/C, the strict ceiling is nprobe ≤ 2000*C / (N*M²). Probed cells skew
    // smaller than average for non-trivial queries, so we can comfortably go
    // ~2× over that ceiling. The previous formula (C/8) produced 256 at C=2048
    // — i.e. 768 OR-terms — and the relevant matches got truncated by
    // pagination order instead of score. Re-tune if N / C / M change.
    nprobe_default: 8,
    model_id: MODEL_ID,
    model_url: `https://huggingface.co/${MODEL_ID}/resolve/main/onnx/model_quantized.onnx`,
    model_sha256: modelSha,
    centroid_set_id: CENTROID_SET_ID,
    centroid_set_hash: centroidSetHash,
    corpus_name: CORPUS_NAME,
    N_chunks: N,
    built_at: new Date().toISOString(),
  };
}

function manifestEntity(manifest: Manifest, expiresIn: number): PreparedEntity {
  return {
    payload: new TextEncoder().encode(JSON.stringify(manifest)),
    contentType: 'application/json',
    attributes: [
      PROJECT_ATTRIBUTE,
      PROTOCOL_ATTRIBUTE,
      { key: 'kind', value: 'manifest' },
      { key: 'model_id', value: MODEL_ID },
      { key: 'centroid_set_id', value: CENTROID_SET_ID },
    ],
    expiresIn,
  };
}

function centroidEntities(centroidsFlat: Float32Array, C: number, centroidSetHash: string, expiresIn: number): PreparedEntity[] {
  const out: PreparedEntity[] = [];
  for (let c = 0; c < C; c++) {
    const slice = centroidsFlat.slice(c * EMBEDDING_DIM, (c + 1) * EMBEDDING_DIM);
    const payload = new Uint8Array(slice.buffer, slice.byteOffset, slice.byteLength);
    out.push({
      payload,
      contentType: 'application/octet-stream',
      attributes: [
        PROJECT_ATTRIBUTE,
        PROTOCOL_ATTRIBUTE,
        { key: 'kind', value: 'centroid' },
        { key: 'model_id', value: MODEL_ID },
        { key: 'centroid_set_id', value: CENTROID_SET_ID },
        { key: 'centroid_set_hash', value: centroidSetHash },
        { key: 'cell_id', value: c },
      ],
      expiresIn,
    });
  }
  return out;
}

function chunkEntities(
  chunks: ChunkRow[],
  embeddings: Float32Array,
  cells: Int16Array,
  N: number,
  M: number,
  expiresIn: number,
): PreparedEntity[] {
  const out: PreparedEntity[] = [];
  for (let i = 0; i < N; i++) {
    const emb = embeddings.slice(i * EMBEDDING_DIM, (i + 1) * EMBEDDING_DIM);
    const packed = quantizeInt8(emb);
    const row = chunks[i]!;
    const payload: ChunkPayload = {
      emb: packed,
      text: row.text,
      title: row.title,
      url: row.url,
      parent_doc_id: row.parent_doc_id,
    };
    const c0 = cells[i * M + 0]!;
    const c1 = cells[i * M + 1] ?? c0;
    const c2 = cells[i * M + 2] ?? c1;
    out.push({
      payload: msgpackEncode(payload),
      contentType: 'application/x-arkiv-chunk-v1',
      attributes: [
        PROJECT_ATTRIBUTE,
        PROTOCOL_ATTRIBUTE,
        { key: 'kind', value: 'chunk' },
        { key: 'model_id', value: MODEL_ID },
        { key: 'centroid_set_id', value: CENTROID_SET_ID },
        { key: 'lang', value: 'en' },
        { key: 'parent_doc_id', value: row.parent_doc_id },
        { key: 'chunk_index', value: row.chunk_index },
        { key: 'cell_id_0', value: c0 },
        { key: 'cell_id_1', value: c1 },
        { key: 'cell_id_2', value: c2 },
      ],
      expiresIn,
    });
  }
  return out;
}

interface PublishOptions { startIndex?: number; initialBatch?: number }

/** Publish entities, starting at MAX_BATCH and halving on failure until a size
 * sticks. Once we have a working size we keep it locked for the rest of the
 * phase. On every transient failure mid-run we halve again. Returns the
 * batch size we ended up using. */
async function publishBatched(
  walletClient: { mutateEntities: (args: { creates: PreparedEntity[] }) => Promise<unknown> },
  entities: PreparedEntity[],
  label: string,
  opts: PublishOptions = {},
): Promise<number> {
  let cursor = opts.startIndex ?? 0;
  let batch = Math.min(opts.initialBatch ?? MAX_BATCH, entities.length - cursor);
  const t0 = Date.now();
  while (cursor < entities.length) {
    const end = Math.min(cursor + batch, entities.length);
    const slice = entities.slice(cursor, end);
    try {
      const result = await walletClient.mutateEntities({ creates: slice });
      cursor = end;
      const txHash = (result as { txHash?: string }).txHash;
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      const rate = (cursor - (opts.startIndex ?? 0)) / Math.max((Date.now() - t0) / 1000, 0.001);
      const remaining = entities.length - cursor;
      const etaSec = remaining > 0 ? (remaining / rate) : 0;
      const eta = etaSec > 60 ? `${(etaSec / 60).toFixed(1)}min` : `${etaSec.toFixed(0)}s`;
      console.log(
        `  [${label}] ${cursor}/${entities.length}  batch=${slice.length}  ${elapsed}s  ` +
        `${rate.toFixed(0)}/s  eta=${eta}` +
        (txHash ? `  tx=${txHash.slice(0, 14)}…` : ''),
      );
    } catch (e) {
      const msg = (e as Error).message;
      const halved = Math.floor(batch / 2);
      if (halved < MIN_BATCH) {
        throw new Error(`even batch=${batch} failed at cursor ${cursor}/${entities.length}: ${msg}`);
      }
      console.warn(
        `  [${label}] batch=${batch} failed at cursor=${cursor}/${entities.length}: ${msg.split('\n')[0]}`,
      );
      console.warn(`  [${label}] retrying at batch=${halved}…`);
      batch = halved;
    }
  }
  return batch;
}

async function main() {
  if (!DRY_RUN && !process.env.PRIVATE_KEY) {
    throw new Error('PRIVATE_KEY not set. Run with tsx --env-file=.env, or set it in the shell.');
  }

  const { chunks, embeddings, centroidsFlat, cells, N, C, M } = await loadArtifacts();
  const centroidSetHash = hashCentroids(centroidsFlat);
  const manifest = await buildManifest(N, C, M, centroidSetHash);

  const expiresIn = ExpirationTime.fromDays(EXP_DAYS);
  const manEntity = manifestEntity(manifest, expiresIn);
  const cEntities = centroidEntities(centroidsFlat, C, centroidSetHash, expiresIn);
  const chEntities = chunkEntities(chunks, embeddings, cells, N, M, expiresIn);
  const total = 1 + cEntities.length + chEntities.length;

  console.log(`Subset stats: N=${N} C=${C} M=${M} dim=${EMBEDDING_DIM}`);
  console.log(`Project: ${PROJECT_ATTRIBUTE.key}="${PROJECT_ATTRIBUTE.value}"`);
  console.log(`Centroid set: ${CENTROID_SET_ID} (hash ${centroidSetHash.slice(0, 16)}…)`);
  console.log(`Expiration: ${EXP_DAYS} days (${expiresIn}s)`);
  console.log(`Total entities to publish: ${total} (1 manifest + ${cEntities.length} centroids + ${chEntities.length} chunks)`);
  console.log(`Batch sizing: start at MAX_BATCH=${MAX_BATCH}, halve on failure, floor MIN_BATCH=${MIN_BATCH}`);
  if (START_INDEX > 0) console.log(`Resuming chunks from index ${START_INDEX} (${chEntities.length - START_INDEX} remaining)`);

  if (DRY_RUN) {
    console.log(`\nDRY_RUN=1 — not submitting. Sample entity:`);
    console.log(JSON.stringify({ ...manEntity, payload: `<${manEntity.payload.length} bytes>` }, null, 2));
    return;
  }

  console.log(`\nModel file: ${locateModelFile()} (${fileSize(locateModelFile())} bytes, sha256 ${manifest.model_sha256.slice(0, 16)}…)`);

  const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
  console.log(`Wallet: ${account.address}  →  Braga (${braga.id})`);
  console.log(`Explorer: ${BRAGA_EXPLORER_URL}/address/${account.address}`);

  const walletClient = createWalletClient({
    chain: braga,
    transport: http(),
    account,
  });

  console.log(`Phases to run: ${PHASES.join(', ')}`);
  let lockedBatch = MAX_BATCH;
  if (PHASES.includes('manifest')) {
    console.log(`\n[manifest] Publishing 1 entity…`);
    await publishBatched(walletClient, [manEntity], 'manifest');
  }
  if (PHASES.includes('centroids')) {
    console.log(`\n[centroids] Publishing ${cEntities.length} entities…`);
    lockedBatch = await publishBatched(walletClient, cEntities, 'centroid');
    console.log(`  → centroid phase ended at batch=${lockedBatch}`);
  }
  if (PHASES.includes('chunks')) {
    const remaining = chEntities.length - START_INDEX;
    console.log(`\n[chunks] Publishing ${remaining} entities (starting at ${START_INDEX})…`);
    // Chunks have a smaller per-entity footprint than centroids, so probe
    // afresh from MAX_BATCH rather than inheriting the centroid limit.
    lockedBatch = await publishBatched(walletClient, chEntities, 'chunk', {
      startIndex: START_INDEX,
      initialBatch: MAX_BATCH,
    });
    console.log(`  → chunk phase ended at batch=${lockedBatch}`);
  }

  console.log(`\nDone.`);
  console.log(`Check explorer: ${BRAGA_EXPLORER_URL}/address/${account.address}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
