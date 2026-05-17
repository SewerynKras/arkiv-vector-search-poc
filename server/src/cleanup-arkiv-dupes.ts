// Find and delete duplicate centroid entities on Braga.
//
//   pnpm run cleanup:arkiv                # plan + ask for confirm (dry-run by default)
//   CONFIRM=1 pnpm run cleanup:arkiv      # actually delete
//   KIND=chunk pnpm run cleanup:arkiv     # other entity kinds (centroid|chunk|manifest)
//
// Re-publishing the index without first cleaning up leaves duplicate
// entities on chain for the same cell_id / chunk_index. The bootstrap's
// strict count check then trips because it sees more entities than the
// manifest's C. This script:
//   1. Pages through all entities of the chosen kind under our scope.
//   2. Groups them by their unique key (cell_id for centroids, chunk_index
//      for chunks).
//   3. For groups with >1 entity, keeps the oldest (lowest createdAtBlock)
//      and queues the rest for deletion.
//   4. Submits deletes via mutateEntities in batches.

import { createWalletClient, http } from "@arkiv-network/sdk";
import { privateKeyToAccount } from "@arkiv-network/sdk/accounts";
import { braga } from "@arkiv-network/sdk/chains";

import { createArkivClient } from "@arkiv-search/shared/arkiv-rpc-client";
import { scopeClause } from "@arkiv-search/shared/arkiv";
import { MODEL_ID } from "@arkiv-search/shared/embedding";

const KIND = (process.env.KIND ?? "centroid") as "centroid" | "chunk" | "manifest";
const CENTROID_SET_ID = process.env.CENTROID_SET_ID ?? "ivf-v1";
const CONFIRM = process.env.CONFIRM === "1";
const DELETE_BATCH = Number(process.env.DELETE_BATCH ?? 50);

// Per-kind: which numeric attribute makes an entity "unique" within its set.
// Manifests have no key attribute (we keep one); we'd delete extra by
// createdAtBlock order if multiple exist.
const UNIQUE_ATTR: Record<typeof KIND, string | null> = {
  centroid: "cell_id",
  chunk: "chunk_index",
  manifest: null,
};

async function main() {
  if (!CONFIRM && process.env.PRIVATE_KEY === undefined) {
    // Dry-run path doesn't need keys; we only need a key to actually delete.
  }

  const api = createArkivClient();
  const uniqueAttr = UNIQUE_ATTR[KIND];

  // Build the scoped query. Manifest queries don't have a centroid_set_id
  // filter — we want to find all manifests if cleaning manifests.
  const setFilter =
    KIND === "manifest" ? "" : ` && centroid_set_id = "${CENTROID_SET_ID}"`;
  const q = `kind = "${KIND}" && model_id = "${MODEL_ID}"${setFilter} && ${scopeClause()}`;

  console.log(`Cleanup target: kind=${KIND}${KIND !== "manifest" ? `, centroid_set_id=${CENTROID_SET_ID}` : ""}`);
  console.log(`Mode:           ${CONFIRM ? "DELETE" : "dry-run"} (set CONFIRM=1 to actually delete)`);
  console.log(`Query:          ${q}`);
  console.log();

  // Page through everything matching.
  console.log("Fetching all matching entities…");
  const t0 = Date.now();
  const all: { key: string; uniqueKey: string; createdAtBlock: number }[] = [];
  let pageToken: string | null = null;
  let pageIdx = 0;
  while (true) {
    const page = await api.queryPage(q, 200, pageToken);
    for (const e of page.entities) {
      const uniqueVal =
        uniqueAttr === null
          ? "manifest" // collapse all manifests into one group
          : String(e.numericAttributes[uniqueAttr]);
      all.push({
        key: e.key,
        uniqueKey: uniqueVal,
        createdAtBlock: e.createdAt,
      });
    }
    pageIdx++;
    console.log(`  page ${pageIdx}: +${page.entities.length}  total ${all.length}`);
    if (!page.nextPageToken || page.entities.length === 0) break;
    pageToken = page.nextPageToken;
    if (pageIdx > 1024) throw new Error("pagination runaway (>1024 pages)");
  }
  console.log(`Fetched ${all.length} entities in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // Group by unique key, find duplicates.
  const byUnique = new Map<string, typeof all>();
  for (const e of all) {
    let arr = byUnique.get(e.uniqueKey);
    if (!arr) {
      arr = [];
      byUnique.set(e.uniqueKey, arr);
    }
    arr.push(e);
  }

  // For each group with >1, keep the oldest (lowest createdAtBlock); queue
  // the rest. Deterministic: ties broken by lexicographic key.
  const toDelete: { key: string }[] = [];
  let groupsWithDupes = 0;
  for (const [u, arr] of byUnique) {
    if (arr.length <= 1) continue;
    groupsWithDupes++;
    arr.sort((a, b) =>
      a.createdAtBlock !== b.createdAtBlock
        ? a.createdAtBlock - b.createdAtBlock
        : a.key < b.key ? -1 : 1,
    );
    // arr[0] is the keeper; everything else gets deleted.
    for (let i = 1; i < arr.length; i++) toDelete.push({ key: arr[i]!.key });
    // Log a sample to confirm sanity.
    if (groupsWithDupes <= 3) {
      console.log(
        `  ${u}: ${arr.length} copies → keep ${arr[0]!.key.slice(0, 14)}…, delete ${arr.length - 1}`,
      );
    }
  }

  console.log();
  console.log(`Unique cells covered:  ${byUnique.size}`);
  console.log(`Cells with duplicates: ${groupsWithDupes}`);
  console.log(`Entities to delete:    ${toDelete.length}`);

  if (toDelete.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  if (!CONFIRM) {
    console.log();
    console.log("Dry-run complete. Re-run with CONFIRM=1 to delete.");
    return;
  }

  if (!process.env.PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY not set. Run via `pnpm run cleanup:arkiv` (loads .env).");
  }

  const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
  const wallet = createWalletClient({
    chain: braga,
    transport: http(),
    account,
  });
  console.log(`Wallet: ${account.address} → Braga`);
  console.log(`Batch:  ${DELETE_BATCH}  →  ${Math.ceil(toDelete.length / DELETE_BATCH)} transactions`);
  console.log();

  let done = 0;
  const startedAt = Date.now();
  for (let i = 0; i < toDelete.length; i += DELETE_BATCH) {
    const slice = toDelete.slice(i, i + DELETE_BATCH).map((d) => ({
      entityKey: d.key as `0x${string}`,
    }));
    try {
      const res = (await wallet.mutateEntities({
        deletes: slice,
      })) as { txHash?: string };
      done += slice.length;
      console.log(
        `  ${done}/${toDelete.length}  -${slice.length}  ${((Date.now() - startedAt) / 1000).toFixed(1)}s` +
          (res.txHash ? `  tx=${res.txHash.slice(0, 14)}…` : ""),
      );
    } catch (e) {
      console.error(
        `  batch=${slice.length} failed at cursor ${i}/${toDelete.length}: ${(e as Error).message.split("\n")[0]}`,
      );
      throw e;
    }
  }
  console.log();
  console.log(`Done. Deleted ${done} duplicates.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
