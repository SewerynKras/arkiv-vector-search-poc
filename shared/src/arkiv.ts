// Constants used by every read and every write against Arkiv.
//
// Braga is a shared public database — *anyone* can read it and *anyone* can
// create entities under their own wallet. To distinguish our project's
// entities from the rest of the world we tag every entity with a globally
// unique PROJECT_ATTRIBUTE, and we filter every read query on the same
// attribute. See arkiv-best-practices §1.

import type { Manifest } from './schema';

/** Globally-unique project tag. Must be on every entity we create and in every
 * query we run. Suffix is random to avoid collisions with anyone else who
 * picks similar names. */
export const PROJECT_ATTRIBUTE = {
  key: 'project',
  value: 'arkiv-search-poc-7x9k',
} as const;

/** Protocol/schema version for the entities this project publishes. Bump on
 * any breaking change to attribute names, payload format, or required filters
 * so old clients can keep pointing at the old version while new clients
 * publish under a new one. */
export const PROTOCOL_VERSION = 'v1';
export const PROTOCOL_ATTRIBUTE = {
  key: 'protocol_version',
  value: PROTOCOL_VERSION,
} as const;

/** Trusted creator wallet. Reads filter by `$creator = CREATOR_WALLET_ADDRESS`
 * so spoofed entities from other wallets — even ones that copy our project
 * tag — are excluded. `$creator` is immutable on Arkiv, so this is tamper-proof.
 * Address must be lowercase: that's the canonical form returned by the chain. */
export const CREATOR_WALLET_ADDRESS = '0x85efdb1f14cbbfdeb3a4b3c5982283ef5d0a6991';

/** Default expiration for everything we publish. Generous: enough that the
 * demo survives but not so much that we waste testnet storage fees. */
export const DEFAULT_EXPIRATION_DAYS = 90;

/** Braga testnet RPC endpoint. */
export const BRAGA_RPC_URL = 'https://braga.hoodi.arkiv.network/rpc';
export const BRAGA_EXPLORER_URL = 'https://explorer.braga.hoodi.arkiv.network';
export const BRAGA_CHAIN_ID = 60138453102;

/** Stable scope clauses that must be on every read query: our project tag
 * plus the protocol version we understand. The Arkiv RPC client adds
 * `$creator = CREATOR_WALLET_ADDRESS` on top of this. */
export function scopeClause(): string {
  return `${PROJECT_ATTRIBUTE.key} = "${PROJECT_ATTRIBUTE.value}" && ${PROTOCOL_ATTRIBUTE.key} = "${PROTOCOL_ATTRIBUTE.value}"`;
}

/** Convenience: extra clauses to AND into bootstrap queries (manifest, centroid). */
export function manifestPredicate(modelId: string, centroidSetId: string): string {
  return `kind = "manifest" && model_id = ${JSON.stringify(modelId)} && centroid_set_id = ${JSON.stringify(centroidSetId)} && ${scopeClause()}`;
}

export function centroidPredicate(modelId: string, centroidSetId: string): string {
  return `kind = "centroid" && model_id = ${JSON.stringify(modelId)} && centroid_set_id = ${JSON.stringify(centroidSetId)} && ${scopeClause()}`;
}

/** What we know about the manifest we publish. Used by both publish and bootstrap. */
export function manifestKey(m: Pick<Manifest, 'model_id' | 'centroid_set_id'>): string {
  // Arkiv doesn't let us choose the key (it's auto-generated from the tx), so
  // this is informational only — used in CLI/UI to label the entity.
  return `manifest:${m.model_id}:${m.centroid_set_id}`;
}
