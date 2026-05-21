// The vertical list of result cards. Empty / bootstrap-loading / search-
// running / error states all live here.
//
// Bootstrap-loading shows the current setup phase (e.g. "Loading AI model")
// without duplicating the right-column stepper detail — just enough to
// tell the user the disabled search bar isn't broken.

import type { SearchResultGroup } from "@arkiv-search/shared/search";

import { ResultCard } from "./result-card";

const SKELETON_COUNT = 5;

export function ResultsList({
  groups,
  running,
  error,
  bootstrapReady,
  bootstrapStatus,
}: {
  groups: SearchResultGroup[];
  running: boolean;
  error: string | null;
  bootstrapReady: boolean;
  bootstrapStatus: string;
}) {
  if (error) {
    return (
      <div className="mt-4 whitespace-pre-wrap rounded-sm border border-destructive/40 bg-destructive/5 px-3.5 py-2.5 font-mono text-xs text-destructive">
        {error}
      </div>
    );
  }
  if (!bootstrapReady) {
    return <BootstrapLoadingPanel status={bootstrapStatus} />;
  }
  if (running && groups.length === 0) {
    return (
      <div className="space-y-5">
        {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
          <SkeletonResultCard key={i} rank={i + 1} delay={i * 35} />
        ))}
      </div>
    );
  }
  if (groups.length === 0) {
    return (
      <div className="space-y-3 rounded-sm border border-border bg-card px-4 py-3 text-sm leading-relaxed text-muted-foreground">
        <p className="text-foreground">Run a query to see results here.</p>
        <p>
          The dataset is a 100,000-article slice of{" "}
          <a
            className="text-primary hover:underline"
            href="https://simple.wikipedia.org/"
            target="_blank"
            rel="noopener"
          >
            Simple English Wikipedia
          </a>{" "}
          — about 322k passages, not the full encyclopedia. Niche topics will
          likely be missing; the closest available articles come back
          instead. Try the example chips above or anything in plain English;
          the search understands meaning, not just keywords.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      {groups.map((g, i) => (
        <ResultCard key={g.pid} group={g} rank={i + 1} delay={i * 25} />
      ))}
    </div>
  );
}

function BootstrapLoadingPanel({ status }: { status: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-3 rounded-sm border border-border bg-card px-4 py-3 text-sm leading-relaxed"
    >
      <Spinner />
      <div className="space-y-1">
        <p className="text-foreground">Setting up the index…</p>
        <p className="font-mono text-[11px] text-muted-foreground">{status}</p>
        <p className="text-xs text-muted-foreground">
          Right panel shows step-by-step detail. Cached on subsequent loads.
        </p>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="mt-0.5 size-4 shrink-0 animate-spin text-primary"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-75"
        d="M4 12a8 8 0 0 1 8-8"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SkeletonResultCard({
  rank,
  delay,
}: {
  rank: number;
  delay: number;
}) {
  return (
    <article
      role="status"
      aria-label={`Loading result ${rank}`}
      className="duration-200 ease-out animate-in fade-in slide-in-from-bottom-1"
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      <div className="mb-1 font-mono text-[11px] text-muted-foreground">
        #{rank}{" "}
        <span className="ml-1.5 inline-block h-3 w-10 animate-pulse rounded-sm bg-muted/60 align-middle" />
      </div>
      <div className="mb-0.5 h-3 w-2/3 animate-pulse rounded-sm bg-muted/40" />
      <div className="mb-3 h-5 w-1/2 animate-pulse rounded-sm bg-muted/60" />
      <div className="space-y-2">
        <div className="h-3.5 w-full animate-pulse rounded-sm bg-muted/60" />
        <div className="h-3.5 w-11/12 animate-pulse rounded-sm bg-muted/60" />
        <div className="h-3.5 w-3/4 animate-pulse rounded-sm bg-muted/60" />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="h-4 w-14 animate-pulse rounded-sm bg-muted/40" />
        <span className="h-4 w-14 animate-pulse rounded-sm bg-muted/40" />
        <span className="h-4 w-24 animate-pulse rounded-sm bg-muted/40" />
      </div>
    </article>
  );
}
