// The vertical list of result cards. Empty/loading/error states live here.

import type { SearchResultGroup } from "@arkiv-search/shared/search";

import { ResultCard } from "./result-card";

export function ResultsList({
  groups,
  running,
  error,
}: {
  groups: SearchResultGroup[];
  running: boolean;
  error: string | null;
}) {
  if (error) {
    return (
      <div className="mt-4 whitespace-pre-wrap rounded-sm border border-destructive/40 bg-destructive/5 px-3.5 py-2.5 font-mono text-xs text-destructive">
        {error}
      </div>
    );
  }
  if (!running && groups.length === 0) {
    return (
      <div className="space-y-3 rounded-sm border border-border bg-card px-4 py-3 text-sm leading-relaxed text-muted-foreground">
        <p className="text-foreground">Run a query to see results here.</p>
        <p>
          The dataset is a ~30,000-article slice of{" "}
          <a
            className="text-primary hover:underline"
            href="https://simple.wikipedia.org/"
            target="_blank"
            rel="noopener"
          >
            Simple English Wikipedia
          </a>{" "}
          — about 96k passages, not the full encyclopedia. Niche topics will
          likely be missing; the closest available articles come back instead.
          Try the example chips above or anything in plain English; the
          search understands meaning, not just keywords.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      {groups.map((g, i) => (
        <ResultCard key={g.parent_doc_id} group={g} rank={i + 1} delay={i * 25} />
      ))}
    </div>
  );
}
