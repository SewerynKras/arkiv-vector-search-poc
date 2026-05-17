// URL builders for the Arkiv data viewer. `data.arkiv.network` only knows
// about hex-keyed Arkiv entities and 0x-prefixed wallet addresses — the
// helpers return null for synthetic keys (used in local-SQLite dev mode) so
// callers can render a plain label instead of a broken link.

const ENTITY_BASE = "https://data.arkiv.network/entity/";
const CREATOR_BASE = "https://data.arkiv.network/creator/";

export function arkivEntityUrl(key: string): string | null {
  return key.startsWith("0x") ? `${ENTITY_BASE}${key}` : null;
}

export function arkivCreatorUrl(address: string): string {
  return `${CREATOR_BASE}${address}`;
}

/** Truncate a long hex key for display: 0xd8359c…502c2c. */
export function shortKey(k: string): string {
  if (k.length <= 14) return k;
  return `${k.slice(0, 8)}…${k.slice(-6)}`;
}
