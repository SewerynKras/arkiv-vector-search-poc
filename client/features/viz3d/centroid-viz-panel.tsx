"use client"

// Always-mounted host for the 3D centroid viz. Lives in the right column
// below the stepper so PCA + Three.js setup runs once (when centroids finish
// loading) instead of every time the user expands the centroids step. PCA
// on 8192 × 384 is ~10-25s in pure JS (~1s in the Web Worker we use now) —
// paying that on every toggle is a terrible UX.
//
// Also owns the click-pinned metadata popover: when the user clicks a dot
// we render a small floating card with cell ID / score / rank / entity key
// and a link to data.arkiv.network. An rAF loop keeps the card anchored to
// the centroid as the user rotates the scene.

import { useCallback, useEffect, useRef, useState } from "react"

import { arkivEntityUrl, shortKey } from "@/features/arkiv/links"
import { CentroidViz3DCanvas, type Viz3DHandle } from "./centroid-viz-3d"

export interface CentroidVizPanelProps {
  centroids: Float32Array | null
  dim: number | undefined
  /** Entity keys indexed by cell_id. The viz uses these for the click popover
   * link to data.arkiv.network. */
  centroidKeys: string[]
  /** Last query's per-cell similarity scores, if a search has run. */
  cellScores?: Float32Array
  /** Last query's probed cells, if a search has run. */
  probedCells?: number[]
  vizRef?: import("react").Ref<Viz3DHandle | null>
  /** Optional: notified whenever the selection changes (for parent callers). */
  onCellSelect?: (cellId: number | null) => void
}

export function CentroidVizPanel({
  centroids,
  dim,
  centroidKeys,
  cellScores,
  probedCells,
  vizRef,
  onCellSelect,
}: CentroidVizPanelProps) {
  // The panel owns its own viz ref so it can drive pointScreenPos for the
  // tooltip placement. We forward to the parent ref too via a callback.
  const localVizRef = useRef<Viz3DHandle | null>(null)
  const captureVizRef = useCallback(
    (handle: Viz3DHandle | null) => {
      localVizRef.current = handle
      if (typeof vizRef === "function") vizRef(handle)
      else if (vizRef && typeof vizRef === "object")
        (vizRef as { current: Viz3DHandle | null }).current = handle
    },
    [vizRef]
  )

  const [selected, setSelected] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Notify the parent on selection change (decoupled from viz internals).
  useEffect(() => {
    onCellSelect?.(selected)
  }, [selected, onCellSelect])

  // Re-position the popover on every animation frame while a cell is
  // selected. Cheap: one matrix proj + one transform per frame.
  useEffect(() => {
    if (selected === null) return
    let raf = 0
    const tick = () => {
      const pos = localVizRef.current?.pointScreenPos(selected)
      const popover = popoverRef.current
      if (popover && pos) {
        popover.style.visibility = "visible"
        popover.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`
      } else if (popover) {
        popover.style.visibility = "hidden"
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [selected])

  // Dismiss on outside click. Clicks inside the canvas re-fire onSelect
  // (cellId or null), which already sets `selected`, so we only need to
  // catch clicks that land outside both the canvas and the popover.
  useEffect(() => {
    if (selected === null) return
    const onMouseDown = (ev: MouseEvent) => {
      const t = ev.target as Node | null
      if (!t) return
      if (containerRef.current?.contains(t)) return
      if (popoverRef.current?.contains(t)) return
      setSelected(null)
    }
    document.addEventListener("mousedown", onMouseDown)
    return () => document.removeEventListener("mousedown", onMouseDown)
  }, [selected])

  return (
    <section className="relative mt-6">
      <div className="mb-2 flex items-center gap-2 font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
        <span>3D centroid space</span>
        <span className="flex-1" />
        <span className="text-[9px] normal-case">drag · zoom · click</span>
      </div>
      <div
        ref={containerRef}
        className="relative rounded-sm border border-border bg-card p-2"
      >
        {centroids && dim ? (
          <CentroidViz3DCanvas
            ref={captureVizRef}
            centroids={centroids}
            C={centroids.length / dim}
            dim={dim}
            onSelect={(cellId) => setSelected(cellId)}
            className="relative aspect-square w-full overflow-hidden rounded-sm"
          />
        ) : (
          <div className="flex aspect-square w-full items-center justify-center text-xs text-muted-foreground italic">
            waiting on centroids…
          </div>
        )}

        {selected !== null && (
          <div
            ref={popoverRef}
            className="pointer-events-auto absolute top-2 left-2 z-10 origin-top-left will-change-transform"
            style={{ visibility: "hidden" }}
          >
            <CentroidPopover
              cellId={selected}
              centroidKey={centroidKeys[selected] ?? ""}
              cellScores={cellScores}
              probed={probedCells?.includes(selected) ?? false}
              onClose={() => setSelected(null)}
            />
          </div>
        )}
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground italic">
        Think of this as a map of meanings - articles that say similar things
        sit close together. Each dot marks the centre of one neighbourhood; the
        black arrow is your query dropped onto the same map. Bright dots are
        close to your query, faded ones are far away. The search peeks inside
        the nearest neighbourhoods (highlighted blue) and ranks the articles it
        finds; orange-ringed dots are the neighbourhoods that produced your top
        results. The real map has 384 dimensions - what you see is a 3D shadow
        of it, so dots that look close here are <strong>roughly</strong>{" "}
        related, not exactly.
      </p>
    </section>
  )
}

function CentroidPopover({
  cellId,
  centroidKey,
  cellScores,
  probed,
  onClose,
}: {
  cellId: number
  centroidKey: string
  cellScores?: Float32Array
  probed: boolean
  onClose: () => void
}) {
  const score = cellScores?.[cellId]
  const rank =
    score !== undefined && cellScores ? computeRank(cellScores, cellId) : null
  const total = cellScores?.length ?? 0
  const link = arkivEntityUrl(centroidKey)

  return (
    <div className="relative mt-1 ml-3 min-w-[220px] rounded-sm border border-border bg-popover px-3 py-2 font-mono text-[11px] text-popover-foreground shadow-lg">
      <div className="mb-1 flex items-center justify-between gap-2 text-foreground">
        <span className="font-semibold">cell {cellId}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground"
        >
          ✕
        </button>
      </div>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5">
        <dt className="text-muted-foreground">key</dt>
        <dd className="truncate text-foreground/80" title={centroidKey}>
          {centroidKey ? shortKey(centroidKey) : "—"}
        </dd>
        <dt className="text-muted-foreground">cos sim</dt>
        <dd className="text-primary">
          {score !== undefined ? score.toFixed(4) : "—"}
        </dd>
        {rank !== null && (
          <>
            <dt className="text-muted-foreground">rank</dt>
            <dd className="text-foreground/80">
              #{rank + 1} / {total}
            </dd>
          </>
        )}
        {probed && (
          <>
            <dt className="text-muted-foreground">status</dt>
            <dd className="text-primary">probed</dd>
          </>
        )}
      </dl>
      {link && (
        <div className="mt-2 border-t border-border pt-1.5">
          <a
            href={link}
            target="_blank"
            rel="noopener"
            className="font-sans text-[11px] text-primary hover:underline"
          >
            View entity on Arkiv ↗
          </a>
        </div>
      )}
    </div>
  )
}

/** Rank of a cell within the full score list (0 = top). Computed on demand
 * because the panel doesn't store a precomputed rank table. */
function computeRank(scores: Float32Array, cellId: number): number {
  const me = scores[cellId]!
  let above = 0
  for (let i = 0; i < scores.length; i++) {
    if (scores[i]! > me) above++
  }
  return above
}
