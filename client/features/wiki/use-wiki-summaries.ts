"use client";

// Wikipedia summary fetcher. Result cards no longer carry text — title and
// extract come from the public REST summary endpoint at display time. CORS
// is enabled there; no proxy needed.
//
// Deduplication, caching, and concurrent-render safety are handled by
// TanStack Query under the hood — see `QueryProvider` at the app root.

import { useQuery } from "@tanstack/react-query";

export interface WikiSummary {
  title: string;
  extract: string;
  thumbnailUrl?: string;
}

// Parse a Wikipedia article URL into its host + url-encoded title segment.
// Returns null for any non-wiki url. The summary endpoint is
//   https://{host}/api/rest_v1/page/summary/{title}
function parseWikiUrl(url: string): { host: string; title: string } | null {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/^\/wiki\/(.+)$/);
    if (!m) return null;
    return { host: u.host, title: m[1]! };
  } catch {
    return null;
  }
}

async function fetchSummary(url: string): Promise<WikiSummary | null> {
  const parsed = parseWikiUrl(url);
  if (!parsed) return null;
  const api = `https://${parsed.host}/api/rest_v1/page/summary/${parsed.title}`;
  const res = await fetch(api);
  if (!res.ok) {
    // 404 (article doesn't exist / redirect) is non-fatal — return null.
    if (res.status === 404) return null;
    throw new Error(`wiki summary ${api}: ${res.status}`);
  }
  const j = (await res.json()) as {
    title?: string;
    extract?: string;
    thumbnail?: { source?: string };
  };
  return {
    title: j.title ?? parsed.title.replace(/_/g, " "),
    extract: j.extract ?? "",
    thumbnailUrl: j.thumbnail?.source,
  };
}

// Returns the Wikipedia summary for a URL once available. `undefined` while
// loading, `null` if the URL isn't a Wikipedia link or the article wasn't
// found.
export function useWikiSummary(url: string | null): WikiSummary | null | undefined {
  const { data } = useQuery({
    queryKey: ["wiki-summary", url],
    queryFn: () => fetchSummary(url!),
    enabled: !!url,
  });
  return data;
}
