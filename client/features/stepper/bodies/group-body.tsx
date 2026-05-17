// Group step body: article-level summary of the rerank output.

import type { SearchResultGroup } from "@arkiv-search/shared/search";

export function GroupBody({ groups }: { groups: SearchResultGroup[] }) {
  if (groups.length === 0) {
    return <span className="italic text-muted-foreground">—</span>;
  }
  const totalChunks = groups.reduce((a, g) => a + g.chunks.length, 0);
  const totalCands = groups.reduce((a, g) => a + g.totalInGroup, 0);
  return (
    <div className="space-y-2">
      <p className="text-[12.5px] text-foreground/80">
        {groups.length} article{groups.length === 1 ? "" : "s"} · {totalChunks}{" "}
        visible chunks · {totalCands} chunks total in candidate pool
      </p>
      <dl className="grid grid-cols-[28px_1fr] gap-x-3.5 gap-y-1 font-mono text-[11px]">
        {groups.slice(0, 10).map((g, i) => (
          <Row key={g.parent_doc_id} rank={i + 1} group={g} />
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
        {group.title}{" "}
        <code className="text-muted-foreground">
          ({group.chunks.length}/{group.totalInGroup})
        </code>
      </dd>
    </>
  );
}
