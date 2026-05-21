// Build-time environment for the client. NEXT_PUBLIC_* vars are inlined into
// the static bundle by Next; everything else is unavailable in the browser.
// Set these in client/.env.local or via CI.

/** Which IVF set we ask Arkiv for. Defaults to the v3 corpus
 * (`ivf-v3`, N=322789, C=8192, turboquant-wasm chunk embeddings).
 * Set to `ivf-v2` (96k chunks, 2048 centroids) for the smaller older index.
 * Override with NEXT_PUBLIC_CENTROID_SET_ID. */
export const CENTROID_SET_ID =
  process.env.NEXT_PUBLIC_CENTROID_SET_ID ?? "ivf-v3";
