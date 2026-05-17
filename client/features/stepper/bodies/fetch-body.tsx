// Fetch step body: one sub-row per page fetched, plus a running total.

import type { PageRow } from "@/features/search/use-search";

export interface FetchBodyProps {
  pages: PageRow[];
  candidates: number;
}

export function FetchBody({ pages, candidates }: FetchBodyProps) {
  if (pages.length === 0) {
    return <span className="italic text-muted-foreground">waiting…</span>;
  }
  return (
    <div className="space-y-2">
      <p className="text-[12.5px] text-foreground/80">
        {candidates.toLocaleString()} candidates over {pages.length} page
        {pages.length === 1 ? "" : "s"}
      </p>
      <div className="space-y-0.5 border-l border-dashed border-border pl-3 font-mono text-[10.5px]">
        {pages.map((p) => (
          <div
            key={p.idx}
            className="flex justify-between gap-2.5 leading-relaxed"
          >
            <span>page {p.idx}</span>
            <span className="text-foreground/80">
              +{p.count} · {p.total} total · {p.ms}ms
              {p.hasMore ? "" : " (last)"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
