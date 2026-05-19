// Group step body: article-level summary of the rerank output.

import type { SearchResultGroup } from "@arkiv-search/shared/search";

export function GroupBody({ groups }: { groups: SearchResultGroup[] }) {
  if (groups.length === 0) {
    return <span className="italic text-muted-foreground">—</span>;
  }
  const totalCands = groups.reduce((a, g) => a + g.hits, 0);
  return (
    <div className="space-y-2">
      <p className="text-[12.5px] text-foreground/80">
        {groups.length} article{groups.length === 1 ? "" : "s"} · {totalCands}{" "}
        chunks in candidate pool
      </p>
      <dl className="grid grid-cols-[28px_1fr] gap-x-3.5 gap-y-1 font-mono text-[11px]">
        {groups.slice(0, 10).map((g, i) => (
          <Row key={g.pid} rank={i + 1} group={g} />
        ))}
      </dl>
    </div>
  );
}

function Row({ rank, group }: { rank: number; group: SearchResultGroup }) {
  return (
    <>
      <dt className="text-muted-foreground">#{rank}</dt>
      <dd className="text-foreground/80">
        <span className="text-primary">{group.bestScore.toFixed(3)}</span>{" "}
        <span className="text-muted-foreground">·</span>{" "}
        <a
          href={group.url}
          target="_blank"
          rel="noopener"
          className="hover:underline"
        >
          {prettyUrl(group.url)}
        </a>{" "}
        <code className="text-muted-foreground">({group.hits})</code>
      </dd>
    </>
  );
}

function prettyUrl(url: string): string {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/^\/wiki\/(.+)$/);
    if (!m) return url;
    return decodeURIComponent(m[1]!).replace(/_/g, " ");
  } catch {
    return url;
  }
}
