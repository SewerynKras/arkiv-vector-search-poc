// One-liners for every step header. Written for non-technical viewers.
// Imported by `Step` and shown on hover via shadcn Tooltip.

export const STEP_TIPS = {
  // Bootstrap
  connect:
    "Open a connection to the data source. On Arkiv this is the public Braga RPC endpoint; in local mode it's a SQLite-backed dev server that mimics Arkiv's query shape.",
  model:
    "Load the AI embedding model in your browser. The first visit downloads ~33 MB; later visits use the cached copy.",
  manifest:
    "Fetch the index manifest entity — the small JSON record that tells you N, C, M, the model SHA, the centroid-set hash, and the TurboQuant config.",
  centroids:
    "Fetch every cluster center. The browser holds them in memory and uses them to decide which clusters to search at query time. Centroids are packed 80 per entity (103 entities at C=8192), paginated 8 at a time to stay under Arkiv's RPC response budget.",

  // Per-search
  embed:
    "Tokenise your query and run it through the same AI model used to index the corpus. Produces a 384-number vector that captures the query's meaning.",
  score:
    "Compute cosine similarity between the query and every cluster center, then pick the top-nprobe — those are the only clusters we'll open.",
  build:
    "Build the Arkiv DSL query — an OR of cluster-ID equalities plus the project, protocol_version, and $creator filters.",
  fetch:
    "Send the query to the database and pull the matching chunk buckets. Each bucket entity carries many chunks from the same cluster, msgpacked together.",
  rerank:
    "For each candidate chunk, compute an unbiased inner-product estimate via turboquant-wasm (3 bits/dim, ~50× smaller than float) and keep the top-k.",
  group:
    "Group the top chunks by article so multiple passages from the same Wikipedia page collapse into one card.",
  done: "Total wall-clock time from clicking Search to seeing results, including every network round-trip.",
} as const;

export type StepId = keyof typeof STEP_TIPS;
