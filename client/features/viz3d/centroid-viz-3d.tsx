"use client";

// React wrapper around the imperative three.js viz module. Mounts/unmounts a
// canvas, exposes the underlying instance via a ref so the parent search
// hook can drive paintScores/markProbed/markHits/reset.

import { useEffect, useRef, type Ref } from "react";

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

/** Apply a callback / object ref to a value, mimicking React's own ref
 * forwarding. We do this manually because useImperativeHandle runs at
 * render time — before the post-mount effect that creates the viz — so
 * the handle would always be null. */
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

  useEffect(() => {
    if (!containerRef.current) return;
    const viz = createCentroidViz3D({
      container: containerRef.current,
      centroids,
      C,
      dim,
      onSelect,
    });
    applyRef(ref, viz);
    return () => {
      viz.dispose();
      applyRef(ref, null);
    };
    // centroids / C / dim only change when the index reloads; the onSelect
    // handler is stable from the parent's perspective. Re-init only when the
    // dataset itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centroids, C, dim]);

  return (
    <div
      ref={containerRef}
      className={
        className ??
        "relative aspect-square w-full overflow-hidden rounded-sm border border-border bg-card"
      }
    />
  );
}
