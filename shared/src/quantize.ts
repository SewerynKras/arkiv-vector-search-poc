// Vector quantization for chunk embeddings.
//
// Active scheme is **turboquant-wasm** (Zig → WASM + relaxed SIMD), wrapping
// Google's TurboQuant algorithm. We pass the WASM engine straight through to
// callers — see `shared/src/search.ts` for the bootstrap-time init and
// `server/src/publish-arkiv.ts` for the per-vector `encode()` loop.
//
// One wrinkle: TurboQuant.init requires `dim` to be a power of 2; bge-small
// is 384-dim (= 1.5 × 2^8). We pad to the next power of 2 (512) at encode
// and at query time. Dot products are unaffected by zero-tail padding, so
// scoring stays correct.

export { TurboQuant } from "turboquant-wasm";
export type { TurboQuantConfig } from "turboquant-wasm";

// Smallest power of 2 ≥ n. We choose `tqDim = nextPow2(modelDim)` once at
// publish time and write it into the manifest so the client matches.
export function nextPow2(n: number): number {
  if (n <= 1) return 1;
  return 1 << Math.ceil(Math.log2(n));
}

// Return `v` zero-padded to length `tqDim`. If lengths already match the
// input is returned as-is to avoid allocation.
export function padToTqDim(v: Float32Array, tqDim: number): Float32Array {
  if (v.length === tqDim) return v;
  if (v.length > tqDim)
    throw new Error(`padToTqDim: input length ${v.length} > tqDim ${tqDim}`);
  const out = new Float32Array(tqDim);
  out.set(v);
  return out;
}
