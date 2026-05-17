// Build-time environment for the client. NEXT_PUBLIC_* vars are inlined into
// the static bundle by Next; everything else is unavailable in the browser.
// Set these in client/.env.local or via CI.

/** Which IVF set we ask Arkiv for. Defaults to the full N=96760, C=2048 set
 * (`ivf-v1`). Override with NEXT_PUBLIC_CENTROID_SET_ID. */
export const CENTROID_SET_ID =
  process.env.NEXT_PUBLIC_CENTROID_SET_ID ?? "ivf-v1";
