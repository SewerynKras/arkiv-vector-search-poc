// One-liners for every step header. Written for non-technical viewers.
// Imported by `Step` and shown on hover via shadcn Tooltip.

export const STEP_TIPS = {
  // Bootstrap
  connect:
    "Open a connection to the data source. On Arkiv this is the public Braga RPC endpoint; in local mode it's a SQLite-backed dev server that mimics Arkiv's query shape.",
  model:
    "Load the AI embedding model in your browser. The first visit downloads ~33 MB; later visits use the cached copy.",
  manifest:
    "Fetch the index manifest entity — the small JSON record that tells you N, C, M, the model SHA, and the centroid-set hash.",
  centroids:
    "Fetch every cluster center. The browser holds them in memory and uses them to decide which clusters to search at query time. With C=2048 this is 11 pages of 200.",

  // Per-search
  embed:
    "Tokenise your query and run it through the same AI model used to index the corpus. Produces a 384-number vector that captures the query's meaning.",
  score:
    "Compute cosine similarity between the query and every cluster center, then pick the top-nprobe — those are the only clusters we'll open.",
  build:
    "Build the Arkiv DSL query — an OR of cluster-ID equalities plus the project, protocol_version, and $creator filters.",
  fetch:
    "Send the query to the database and pull paginated candidate passages (up to 200 per page, capped by Arkiv).",
  rerank:
    "For each candidate, compute the exact int8-quantised dot product against the query and keep the top-k chunks.",
  group:
    "Group the top chunks by article so multiple passages from the same Wikipedia page collapse into one card.",
  done: "Total wall-clock time from clicking Search to seeing results, including every network round-trip.",
} as const;

export type StepId = keyof typeof STEP_TIPS;
