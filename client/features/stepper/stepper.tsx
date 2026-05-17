"use client";

// The right-column wrapper. Owns the open-state map for every step (so the
// expand-all / collapse-all chips can flip them all at once) and renders the
// two sections.

import { useState } from "react";

import { Header } from "./stepper-header";
import { BootstrapSection } from "./bootstrap-section";
import { SearchSection } from "./search-section";
import type { BootstrapState } from "@/features/bootstrap/use-bootstrap";
import type { SearchSlice } from "@/features/search/use-search";

const ALL_STEP_IDS = [
  // Bootstrap
  "connect",
  "model",
  "manifest",
  "centroids",
  // Search
  "embed",
  "score",
  "build",
  "fetch",
  "rerank",
  "group",
  "done",
] as const;

export type OpenMap = Record<string, boolean>;
export type ToggleStep = (id: string) => void;

export function Stepper({
  bootstrap,
  search,
}: {
  bootstrap: BootstrapState;
  search: SearchSlice;
}) {
  // All steps start collapsed.
  const [openMap, setOpenMap] = useState<OpenMap>({});

  const toggle: ToggleStep = (id) => {
    setOpenMap((m) => ({ ...m, [id]: !m[id] }));
  };
  const expandAll = () => {
    const next: OpenMap = {};
    for (const id of ALL_STEP_IDS) next[id] = true;
    setOpenMap(next);
  };
  const collapseAll = () => setOpenMap({});

  return (
    <div>
      <Header onExpandAll={expandAll} onCollapseAll={collapseAll} />
      <BootstrapSection
        state={bootstrap}
        openMap={openMap}
        onToggle={toggle}
      />
      <SearchSection
        search={search}
        centroidKeys={bootstrap.centroids.centroidKeys}
        openMap={openMap}
        onToggle={toggle}
      />
    </div>
  );
}
