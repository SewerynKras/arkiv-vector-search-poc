// Rerank step body: top-K chunks after rerank. Each row points to the
// chunk bucket on Arkiv (v2: chunks live inside bucket entities), not to
// the individual chunk.

import type { SearchResult } from "@arkiv-search/shared/search";

import { arkivEntityUrl, shortKey } from "@/features/arkiv/links";

export function RerankBody({ results }: { results: SearchResult[] }) {
  if (results.length === 0) {
    return <span className="italic text-muted-foreground">—</span>;
  }
  return (
    <div className="space-y-2">
      <p className="text-[12.5px] text-foreground/80">
        {results.length} top chunk{results.length === 1 ? "" : "s"} after
        reranking
      </p>
      <ol className="grid gap-1 font-mono text-[11px]">
        {results.slice(0, 10).map((r, i) => {
          const link = arkivEntityUrl(r.bucketKey);
          return (
            <li
              key={r.cid}
              className="grid grid-cols-[24px_56px_1fr_auto] items-baseline gap-2"
            >
              <span className="text-muted-foreground">#{i + 1}</span>
              <span className="text-primary">{r.score.toFixed(3)}</span>
              <span
                className="truncate text-muted-foreground"
                title={r.bucketKey}
              >
                cid {r.cid} · {shortKey(r.bucketKey)}
              </span>
              {link ? (
                <a
                  href={link}
                  target="_blank"
                  rel="noopener"
                  className="text-[10.5px] text-primary hover:underline"
                >
                  view bucket ↗
                </a>
              ) : (
                <span className="text-[10.5px] text-muted-foreground">
                  local
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {results.length > 10 && (
        <p className="font-mono text-[10.5px] italic text-muted-foreground">
          + {results.length - 10} more
        </p>
      )}
    </div>
  );
}
