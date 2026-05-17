// ApiClient implementation that talks directly to Arkiv's JSON-RPC endpoint
// (no proxy in the middle — the demo's "no backend" promise).
//
// Translates the chain's response shape (hex payloads, attribute arrays,
// opaque cursors) to the same EntityResponse shape our local server returns,
// so shared/search.ts works unchanged. Transparently AND-s
// `$creator = CREATOR_WALLET_ADDRESS` onto every query so spoofed entities
// from other wallets — even ones that copied our project tag — are filtered
// out at the chain layer.

import type { ApiClient, EntityResponse, PageResponse } from './api-client';
import { BRAGA_RPC_URL, CREATOR_WALLET_ADDRESS } from './arkiv';

interface ArkivEntity {
  key: string;
  contentType: string;
  value: string; // hex with 0x prefix
  owner?: string;
  creator?: string;
  expiresAt?: number;
  createdAtBlock?: number;
  stringAttributes?: { key: string; value: string }[];
  numericAttributes?: { key: string; value: number | string }[];
}

interface ArkivQueryResult {
  data: ArkivEntity[];
  cursor?: string;
  blockNumber?: string;
}

interface JsonRpcResponse<T> {
  jsonrpc: '2.0';
  id: number | string;
  result?: T;
  error?: { code: number; message: string };
}

function hexToBase64(hex: string): string {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  // To base64 — portable across Node and browser.
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function normalize(e: ArkivEntity): EntityResponse {
  const stringAttributes: Record<string, string> = {};
  for (const a of e.stringAttributes ?? []) stringAttributes[a.key] = a.value;
  const numericAttributes: Record<string, number> = {};
  for (const a of e.numericAttributes ?? []) numericAttributes[a.key] = Number(a.value);
  return {
    key: e.key,
    contentType: e.contentType,
    payload: hexToBase64(e.value),
    owner: e.owner ?? '',
    creator: e.creator ?? '',
    createdAt: e.createdAtBlock ?? 0,
    expiresAt: e.expiresAt ?? null,
    stringAttributes,
    numericAttributes,
  };
}

export interface CreateArkivClientOpts {
  rpcUrl?: string;
  /** Wallet to constrain reads to. Set to null to disable the filter (debug only). */
  creator?: string | null;
}

export function createArkivClient(opts: CreateArkivClientOpts = {}): ApiClient {
  const endpoint = opts.rpcUrl ?? BRAGA_RPC_URL;
  const creator = opts.creator === undefined ? CREATOR_WALLET_ADDRESS : opts.creator;
  let nextId = 1;

  function withCreator(q: string): string {
    if (!creator) return q;
    return `${q} && $creator = "${creator}"`;
  }

  async function rpc<T>(method: string, params: unknown[]): Promise<T> {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
    });
    if (!r.ok) throw new Error(`${method} HTTP ${r.status}: ${await r.text()}`);
    const j = (await r.json()) as JsonRpcResponse<T>;
    if (j.error) throw new Error(`${method}: ${j.error.message}`);
    if (j.result === undefined) throw new Error(`${method}: empty result`);
    return j.result;
  }

  const queryPage = async (q: string, pageSize: number, pageToken: string | null): Promise<PageResponse> => {
    const opts: Record<string, unknown> = {
      resultsPerPage: '0x' + Math.min(pageSize, 200).toString(16),
    };
    if (pageToken) opts.cursor = pageToken;
    const result = await rpc<ArkivQueryResult>('arkiv_query', [withCreator(q), opts]);
    return {
      entities: (result.data ?? []).map(normalize),
      nextPageToken: result.cursor ?? null,
      pageSize: Math.min(pageSize, 200),
    };
  };

  const queryAll = async (q: string, opts: { pageSize?: number; maxPages?: number } = {}): Promise<EntityResponse[]> => {
    const pageSize = opts.pageSize ?? 200;
    const maxPages = opts.maxPages ?? 50;
    const out: EntityResponse[] = [];
    let pageToken: string | null = null;
    for (let p = 0; p < maxPages; p++) {
      const r = await queryPage(q, pageSize, pageToken);
      out.push(...r.entities);
      // Arkiv keeps returning a cursor even when the scan is past the last
      // matching row — an empty page is our real "done" signal.
      if (!r.nextPageToken || r.entities.length === 0) return out;
      pageToken = r.nextPageToken;
    }
    throw new Error(`queryAll: hit maxPages=${maxPages} (last cursor=${pageToken}); query too broad`);
  };

  return { endpoint, queryPage, queryAll };
}
