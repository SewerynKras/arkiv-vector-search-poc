// Web Worker that runs PCA off the main thread. Power iteration on
// 2048×384 takes ~300 ms in V8 — long enough to make the bootstrap → ready
// transition feel janky if we do it on the UI thread.
//
// Wire format: postMessage in with { centroids, C, dim, K, iters, seed }.
// Reply out with the full PcaResult. Transferable ArrayBuffers move the
// big Float32Arrays without copying.

import { pca, type PcaResult } from "@arkiv-search/shared/pca";

interface InMessage {
  centroids: Float32Array;
  C: number;
  dim: number;
  K: number;
  iters?: number;
  seed?: number;
}

self.onmessage = (ev: MessageEvent<InMessage>) => {
  const { centroids, C, dim, K, iters, seed } = ev.data;
  const result: PcaResult = pca(centroids, C, dim, K, { iters, seed });
  // Transfer the typed-array backing buffers so the main thread receives
  // the data without an extra copy.
  (self as unknown as Worker).postMessage(result, {
    transfer: [
      result.components.buffer,
      result.projected.buffer,
      result.mean.buffer,
    ],
  });
};
