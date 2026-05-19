// One article in the results list. Layout: small rank/score caption, URL
// crumb, title (link), Wikipedia extract paragraph, and an Arkiv link to
// the bucket the chunk came from.
//
// Chunk text and title are no longer stored on chain (v2 schema) — we
// fetch them from the Wikipedia REST summary API at render time. The
// fetch is cached across renders/queries by URL.

import type { SearchResultGroup } from "@arkiv-search/shared/search";

import { arkivEntityUrl, shortKey } from "@/features/arkiv/links";
import { useWikiSummary } from "@/features/wiki/use-wiki-summaries";

export function ResultCard({
  group,
  rank,
  delay,
}: {
  group: SearchResultGroup;
  rank: number;
  delay?: number;
}) {
  const summary = useWikiSummary(group.url);
  const top = group.topResult;
  const bucketLink = arkivEntityUrl(top.bucketKey);
  const displayTitle = summary?.title ?? prettifyTitleFromUrl(group.url);

  return (
    <article
      className="duration-200 ease-out animate-in fade-in slide-in-from-bottom-1"
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      <div className="mb-1 font-mono text-[11px] text-muted-foreground">
        #{rank}{" "}
        <span className="ml-1.5 font-semibold text-primary">
          {group.bestScore.toFixed(3)}
        </span>
        {group.hits > 1 && (
          <span className="ml-2 text-muted-foreground">
            {group.hits} passages
          </span>
        )}
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
          {displayTitle}
        </a>
      </h4>
      {/* Reserve ~3 lines (text-[14px] × leading-relaxed ≈ 22px each) so
       *  cards don't jump as Wikipedia extracts stream in at varying
       *  lengths. */}
      <div className="min-h-[66px]">
        {summary?.extract ? (
          <p className="text-[14px] leading-relaxed text-foreground/80">
            {summary.extract}
          </p>
        ) : summary === undefined ? (
          <div
            className="space-y-2"
            role="status"
            aria-label="Loading article extract"
          >
            <div className="h-3.5 w-full animate-pulse rounded-sm bg-muted/60" />
            <div className="h-3.5 w-11/12 animate-pulse rounded-sm bg-muted/60" />
            <div className="h-3.5 w-3/4 animate-pulse rounded-sm bg-muted/60" />
          </div>
        ) : (
          <p className="text-[13px] italic text-muted-foreground">
            No extract available.
          </p>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {top.cellIds
          .filter((c) => c >= 0)
          .map((c) => (
            <span
              key={c}
              className="rounded-sm border border-border px-1.5 py-0 font-mono text-[10px] text-muted-foreground"
            >
              cell {c}
            </span>
          ))}
        {bucketLink && (
          <a
            href={bucketLink}
            target="_blank"
            rel="noopener"
            className="rounded-sm border border-border px-1.5 py-0 font-mono text-[10px] text-primary hover:border-primary hover:underline"
            title={top.bucketKey}
          >
            view bucket on Arkiv ↗ · {shortKey(top.bucketKey)}
          </a>
        )}
      </div>
    </article>
  );
}

function prettifyTitleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/^\/wiki\/(.+)$/);
    if (!m) return url;
    return decodeURIComponent(m[1]!).replace(/_/g, " ");
  } catch {
    return url;
  }
}
