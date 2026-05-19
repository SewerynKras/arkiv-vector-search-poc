// Patch `nprobe_default` on the on-chain manifest entity in place. Useful
// after eval-recall lands on a new sweet spot without wanting to republish
// the whole index.
//
// Usage:
//   pnpm run update-manifest                              # dry-run (prints diff)
//   NPROBE_DEFAULT=16 CONFIRM=1 pnpm run update-manifest  # actually update
//
// Reads PRIVATE_KEY from project-root .env via the package script.

import { createWalletClient, http } from "@arkiv-network/sdk";
import { privateKeyToAccount } from "@arkiv-network/sdk/accounts";
import { braga } from "@arkiv-network/sdk/chains";
import { ExpirationTime } from "@arkiv-network/sdk/utils";

import {
  PROJECT_ATTRIBUTE,
  PROTOCOL_ATTRIBUTE,
  DEFAULT_EXPIRATION_DAYS,
  scopeClause,
} from "@arkiv-search/shared/arkiv";
import { createArkivClient } from "@arkiv-search/shared/arkiv-rpc-client";
import { MODEL_ID } from "@arkiv-search/shared/embedding";
import type { Manifest } from "@arkiv-search/shared/schema";

const CENTROID_SET_ID = process.env.CENTROID_SET_ID ?? "ivf-v2";
const NEW_NPROBE_DEFAULT = Number(process.env.NPROBE_DEFAULT ?? 8);
const EXP_DAYS = Number(process.env.EXP_DAYS ?? DEFAULT_EXPIRATION_DAYS);
const CONFIRM = process.env.CONFIRM === "1";

async function main() {
  const api = createArkivClient();
  const q = `kind = "manifest" && model_id = "${MODEL_ID}" && centroid_set_id = "${CENTROID_SET_ID}" && ${scopeClause()}`;

  console.log(`Locating manifest…`);
  console.log(`  query: ${q}`);
  const page = await api.queryPage(q, 10, null);
  if (page.entities.length === 0) {
    throw new Error("No manifest entity found for the given model_id / centroid_set_id under our scope.");
  }
  if (page.entities.length > 1) {
    // Should never happen after the dupe-cleanup pass, but be loud if it does.
    throw new Error(
      `Found ${page.entities.length} manifest entities — clean up duplicates first (pnpm run cleanup:arkiv KIND=manifest).`,
    );
  }
  const e = page.entities[0]!;
  const decoded = Buffer.from(e.payload, "base64").toString("utf8");
  const existing = JSON.parse(decoded) as Manifest;
  console.log(`  entityKey: ${e.key}`);
  console.log(`  existing nprobe_default: ${existing.nprobe_default}`);

  if (existing.nprobe_default === NEW_NPROBE_DEFAULT) {
    console.log(`Already at nprobe_default=${NEW_NPROBE_DEFAULT}. Nothing to do.`);
    return;
  }

  const updated: Manifest = { ...existing, nprobe_default: NEW_NPROBE_DEFAULT };
  console.log();
  console.log(`Planned update:`);
  console.log(`  nprobe_default: ${existing.nprobe_default}  →  ${NEW_NPROBE_DEFAULT}`);
  console.log(`  (all other fields unchanged)`);
  console.log();

  if (!CONFIRM) {
    console.log("Dry-run. Re-run with CONFIRM=1 to apply.");
    return;
  }

  if (!process.env.PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY not set. Run via the pnpm script so .env is loaded.");
  }

  const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
  const wallet = createWalletClient({ chain: braga, transport: http(), account });
  console.log(`Wallet: ${account.address}  →  Braga`);

  const payload = new TextEncoder().encode(JSON.stringify(updated));
  // updateEntity is a full replace — we must re-supply every attribute the
  // original entity had so queries still find it.
  const res = (await wallet.updateEntity({
    entityKey: e.key as `0x${string}`,
    payload,
    contentType: "application/json",
    attributes: [
      PROJECT_ATTRIBUTE,
      PROTOCOL_ATTRIBUTE,
      { key: "kind", value: "manifest" },
      { key: "model_id", value: MODEL_ID },
      { key: "centroid_set_id", value: CENTROID_SET_ID },
    ],
    expiresIn: ExpirationTime.fromDays(EXP_DAYS),
  })) as { txHash?: string };
  console.log(`Done.${res.txHash ? `  tx=${res.txHash}` : ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
