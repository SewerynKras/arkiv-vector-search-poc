"use client";

// React wrapper around the imperative three.js viz module. Mounts/unmounts a
// canvas, exposes the underlying instance via a ref so the parent search
// hook can drive paintScores/markProbed/markHits/reset.
//
// PCA is run in a Web Worker so the ~300 ms power-iteration pass doesn't
// freeze the main thread while the bootstrap finalises. We render a small
// "computing 3D map…" placeholder until the worker reports back.

import { useEffect, useRef, useState, type Ref } from "react";

import type { PcaResult } from "@arkiv-search/shared/pca";

import {
  createCentroidViz3D,
  type CentroidViz3D,
} from "./viz-core";

export type Viz3DHandle = CentroidViz3D;

export interface CentroidViz3DCanvasProps {
  ref?: Ref<Viz3DHandle | null>;
  centroids: Float32Array;
  C: number;
  dim: number;
  onSelect?: (cellId: number | null) => void;
  className?: string;
}

function applyRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (!ref) return;
  if (typeof ref === "function") {
    (ref as (v: T | null) => void)(value);
  } else if (typeof ref === "object") {
    (ref as { current: T | null }).current = value;
  }
}

export function CentroidViz3DCanvas({
  ref,
  centroids,
  C,
  dim,
  onSelect,
  className,
}: CentroidViz3DCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pcaResult, setPcaResult] = useState<PcaResult | null>(null);

  // Run PCA in a Web Worker so the main thread keeps repainting. The worker
  // postMessages the result back as transferable buffers — no copy on the
  // main side. We reset to null whenever the source centroids change so a
  // stale projection never gets paired with a fresh dataset.
  useEffect(() => {
    setPcaResult(null);
    // We pass a copy of `centroids` into the worker because postMessage with
    // `transfer` would neuter the original on this side, breaking other
    // consumers of the same buffer (e.g., centroid scoring at query time).
    const copy = centroids.slice();
    // Worker source lives in public/ as plain JS so Next's static export
    // publishes it verbatim — bundling `new Worker(new URL(...))` doesn't
    // work with `output: "export"`.
    const worker = new Worker("/pca-worker.js");
    const t0 = performance.now();
    worker.onmessage = (ev: MessageEvent<PcaResult>) => {
      console.log(
        `[viz3d] PCA (worker) done in ${(performance.now() - t0).toFixed(0)}ms, variance =`,
        ev.data.variance.map((v) => v.toFixed(3)),
      );
      setPcaResult(ev.data);
      worker.terminate();
    };
    worker.onerror = (e) => {
      console.error("[viz3d] PCA worker failed:", e);
      worker.terminate();
    };
    worker.postMessage(
      { centroids: copy, C, dim, K: 3, iters: 60 },
      { transfer: [copy.buffer] },
    );
    return () => worker.terminate();
  }, [centroids, C, dim]);

  // Mount the three.js scene only once PCA is in hand.
  useEffect(() => {
    if (!containerRef.current || !pcaResult) return;
    const viz = createCentroidViz3D({
      container: containerRef.current,
      centroids,
      C,
      dim,
      onSelect,
      pcaResult,
    });
    applyRef(ref, viz);
    return () => {
      viz.dispose();
      applyRef(ref, null);
    };
    // onSelect is stable from the parent's perspective; we only re-init when
    // the dataset or its PCA changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centroids, C, dim, pcaResult]);

  return (
    <div
      ref={containerRef}
      className={
        className ??
        "relative aspect-square w-full overflow-hidden rounded-sm border border-border bg-card"
      }
    >
      {!pcaResult && (
        <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground italic">
          computing 3D projection…
        </div>
      )}
    </div>
  );
}
