// Done step body: a recap of every timing slice plus the totals.

import type { SearchStats } from "@arkiv-search/shared/search";

import { KvList, type KvRow } from "@/features/stepper/kv-list";

export function DoneBody({ stats }: { stats?: SearchStats }) {
  if (!stats) {
    return <span className="italic text-muted-foreground">—</span>;
  }
  const totalMs =
    stats.totalMs >= 1000
      ? `${(stats.totalMs / 1000).toFixed(2)} s`
      : `${stats.totalMs} ms`;
  const rows: KvRow[] = [
    { k: "embed", v: `${stats.embedMs} ms` },
    { k: "fetch + rerank", v: `${stats.fetchMs} ms` },
    { k: "total wall clock", v: totalMs, tone: "accent" },
    { k: "pages fetched", v: stats.pages },
    {
      k: "candidates reranked",
      v: stats.candidates.toLocaleString(),
    },
    { k: "OR terms", v: stats.termCount },
    { k: "probed cells", v: stats.probedCells.length },
  ];
  return <KvList rows={rows} />;
}
