// One article in the results list. Google-SERP layout: small rank/score
// caption, URL crumb, title (link), then stacked snippet rows with their
// individual int8 scores, cell tags, and an Arkiv-data-viewer link per chunk.

import type { SearchResultGroup } from "@arkiv-search/shared/search";

import { arkivEntityUrl, shortKey } from "@/features/arkiv/links";

export function ResultCard({
  group,
  rank,
  delay,
}: {
  group: SearchResultGroup;
  rank: number;
  delay?: number;
}) {
  const head = group.chunks[0]!;
  const hidden = group.totalInGroup - group.chunks.length;
  return (
    <article
      className="duration-200 ease-out animate-in fade-in slide-in-from-bottom-1"
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      <div className="mb-1 font-mono text-[11px] text-muted-foreground">
        #{rank}{" "}
        <span className="ml-1.5 font-semibold text-primary">
          {head.score.toFixed(3)}
        </span>
      </div>
      <div className="mb-0.5 break-all text-[12.5px] text-muted-foreground">
        <a
          href={group.url}
          target="_blank"
          rel="noopener"
          className="hover:text-foreground"
        >
          {group.url}
        </a>
      </div>
      <h4 className="mb-2.5 text-lg font-medium leading-tight">
        <a
          href={group.url}
          target="_blank"
          rel="noopener"
          className="text-primary hover:underline"
        >
          {group.title}
        </a>
      </h4>
      <div className="space-y-2.5">
        {group.chunks.map((c, i) => (
          <div
            key={c.key}
            className="grid grid-cols-[48px_1fr] gap-2.5 data-[first=false]:border-t data-[first=false]:border-dashed data-[first=false]:border-border data-[first=false]:pt-2.5"
            data-first={i === 0}
          >
            <div className="pt-0.5 font-mono text-[11px] text-muted-foreground">
              {c.score.toFixed(3)}
            </div>
            <div>
              <p className="text-[14px] leading-relaxed text-foreground/80">
                {c.text}
              </p>
              <ChunkTags cellIds={c.cellIds} chunkKey={c.key} />
            </div>
          </div>
        ))}
      </div>
      {hidden > 0 && (
        <div className="mt-2.5 font-mono text-[11px] italic text-muted-foreground">
          + {hidden} more passage{hidden === 1 ? "" : "s"} from this article in
          the candidate set
        </div>
      )}
    </article>
  );
}

function ChunkTags({
  cellIds,
  chunkKey,
}: {
  cellIds: number[];
  chunkKey: string;
}) {
  const tags = cellIds.filter((x) => x >= 0);
  const link = arkivEntityUrl(chunkKey);
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {tags.map((c) => (
        <span
          key={c}
          className="rounded-sm border border-border px-1.5 py-0 font-mono text-[10px] text-muted-foreground"
        >
          cell {c}
        </span>
      ))}
      {link && (
        <a
          href={link}
          target="_blank"
          rel="noopener"
          className="rounded-sm border border-border px-1.5 py-0 font-mono text-[10px] text-primary hover:border-primary hover:underline"
          title={chunkKey}
        >
          view on Arkiv ↗ · {shortKey(chunkKey)}
        </a>
      )}
    </div>
  );
}
