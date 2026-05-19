"use client"

// Top-level client component for the whole app. Owns the two hooks
// (useBootstrap + useSearch) and the lightweight UI state that lives
// between them (k/nprobe inputs, the SearchBar ref). Every leaf reads
// what it needs as props.

import { useCallback, useEffect, useRef, useState } from "react"

import { useBootstrap } from "@/features/bootstrap/use-bootstrap"
import { ExampleQueries } from "@/features/search/example-queries"
import { ResultsList } from "@/features/search/results-list"
import { SearchBar, type SearchBarHandle } from "@/features/search/search-bar"
import { SearchOptions } from "@/features/search/search-options"
import { useSearch } from "@/features/search/use-search"
import { Stepper } from "@/features/stepper/stepper"
import type { Viz3DHandle } from "@/features/viz3d/centroid-viz-3d"
import { CentroidVizPanel } from "@/features/viz3d/centroid-viz-panel"
import { ArkivMark } from "./arkiv-mark"

export function ArkivSearchApp() {
  const bootstrap = useBootstrap()
  const search = useSearch({
    api: bootstrap.api,
    manifest: bootstrap.manifest.manifest,
    centroids: bootstrap.centroids.centroids,
    tq: bootstrap.quantizer.tq,
  })
  const [k, setK] = useState(10)
  const [nprobe, setNprobe] = useState(16)
  const barRef = useRef<SearchBarHandle>(null)

  // Imperative handle to the 3D viz. Search-event side effects drive it
  // through the three useEffects below.
  const vizRef = useRef<Viz3DHandle | null>(null)

  // Reset viz at the start of each query — keyed on the queryText slice so
  // we only react when a new search begins.
  useEffect(() => {
    if (search.embed.queryText && search.embed.state === "active") {
      vizRef.current?.reset()
    }
  }, [search.embed.queryText, search.embed.state])

  // Paint per-centroid similarity + highlight the probed set when scoring
  // completes.
  useEffect(() => {
    if (
      search.score.state === "done" &&
      search.score.cellScores &&
      search.score.probedCells
    ) {
      vizRef.current?.paintScores(search.score.cellScores)
      vizRef.current?.markProbed(search.score.probedCells)
    }
  }, [search.score.state, search.score.cellScores, search.score.probedCells])

  // Drop the orange query-vector marker as soon as the embedding lands, so
  // the user sees it before scoring even finishes — it's a satisfying "you
  // are here in the embedding space" moment.
  useEffect(() => {
    if (search.embed.state === "done" && search.embed.qVec) {
      vizRef.current?.setQueryPoint(search.embed.qVec)
    }
  }, [search.embed.state, search.embed.qVec])

  // Pink ring around cells that contributed a top-K result.
  useEffect(() => {
    if (search.done.state !== "done") return
    const hits = new Set<number>()
    for (const r of search.results)
      for (const c of r.cellIds) if (c >= 0) hits.add(c)
    vizRef.current?.markHits([...hits])
  }, [search.done.state, search.results])

  const handleCellSelect = useCallback((cellId: number | null) => {
    if (cellId !== null) console.debug("centroid clicked:", cellId)
  }, [])

  return (
    <main className="grid min-h-svh w-full grid-cols-1 gap-6 px-4 pt-4 pb-8 lg:grid-cols-[minmax(0,1fr)_540px]">
      {/* Left column: search bar, examples, results. */}
      <section className="mx-auto w-full max-w-3xl min-w-0">
        <div className="mb-5 flex items-center gap-4">
          <ArkivMark className="h-8 w-auto shrink-0 text-foreground" />
          <div className="flex-1">
            <SearchBar
              ref={barRef}
              disabled={!bootstrap.ready}
              loading={search.running}
              onSubmit={(q) => search.run(q, k, nprobe)}
            />
          </div>
        </div>
        <SearchOptions
          k={k}
          nprobe={nprobe}
          onChangeK={setK}
          onChangeNprobe={setNprobe}
        />
        <ExampleQueries onPick={(q) => barRef.current?.setQuery(q)} />

        <h2 className="mt-6 mb-2 font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
          Results
        </h2>
        <ResultsList
          groups={search.groups}
          running={search.running}
          error={search.error}
        />
      </section>

      {/* Right column: collapsible step-by-step trace, then the always-mounted
       *  3D centroid viz below it. Not sticky — the whole page scrolls so the
       *  user never sees a nested scrollbar. */}
      <aside>
        <Stepper bootstrap={bootstrap} search={search} />
        <CentroidVizPanel
          centroids={bootstrap.centroids.centroids}
          dim={bootstrap.manifest.manifest?.dim}
          centroidKeys={bootstrap.centroids.centroidKeys}
          cellScores={search.score.cellScores}
          probedCells={search.score.probedCells}
          vizRef={vizRef}
          onCellSelect={handleCellSelect}
        />
      </aside>
    </main>
  )
}

