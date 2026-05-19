"use client";

// Per-query state machine. Wraps the shared `search()` driver and translates
// its streaming events into a sliced state object — one slice per right-column
// step plus the final result groups. Components subscribe to the slice they
// care about; React 18 batches the rapid event bursts automatically.

import { useCallback, useReducer } from "react";

import type { ApiClient } from "@arkiv-search/shared/api-client";
import type { TurboQuant } from "@arkiv-search/shared/quantize";
import { search as searchShared } from "@arkiv-search/shared/search";
import type {
  SearchEvent,
  SearchResult,
  SearchResultGroup,
  SearchStats,
} from "@arkiv-search/shared/search";
import type { Manifest } from "@arkiv-search/shared/schema";

import type { StepState } from "@/features/bootstrap/use-bootstrap";

export interface PageRow {
  idx: number;
  count: number;
  total: number;
  ms: number;
  hasMore: boolean;
}

export interface SearchSliceState {
  // Persistent across queries:
  running: boolean;
  error: string | null;
  // Per-step slices:
  embed: {
    state: StepState;
    ms?: number;
    queryNorm?: number;
    qPreview?: Float32Array;
    /** Full query embedding (length = manifest.dim) — needed by the 3D viz
     * to drop a marker into PCA space. */
    qVec?: Float32Array;
    qStats?: { min: number; max: number; meanAbs: number };
    queryText?: string;
  };
  score: {
    state: StepState;
    ms?: number;
    cellScores?: Float32Array;
    probedCells?: number[];
  };
  build: {
    state: StepState;
    dsl?: string;
    termCount?: number;
  };
  fetch: {
    state: StepState;
    ms?: number;
    pages: PageRow[];
    candidates: number;
  };
  rerank: { state: StepState; ms?: number };
  group: { state: StepState };
  done: { state: StepState; stats?: SearchStats };
  // Final outputs (visible in the left column):
  results: SearchResult[];
  groups: SearchResultGroup[];
}

const INITIAL: SearchSliceState = {
  running: false,
  error: null,
  embed: { state: "pending" },
  score: { state: "pending" },
  build: { state: "pending" },
  fetch: { state: "pending", pages: [], candidates: 0 },
  rerank: { state: "pending" },
  group: { state: "pending" },
  done: { state: "pending" },
  results: [],
  groups: [],
};

type Action =
  | { type: "start"; queryText: string }
  | { type: "ev"; ev: SearchEvent }
  | { type: "error"; message: string };

function reducer(s: SearchSliceState, a: Action): SearchSliceState {
  switch (a.type) {
    case "start":
      return {
        ...INITIAL,
        running: true,
        embed: { state: "active", queryText: a.queryText },
      };
    case "ev":
      return applyEvent(s, a.ev);
    case "error":
      return {
        ...s,
        running: false,
        error: a.message,
      };
  }
}

function applyEvent(s: SearchSliceState, ev: SearchEvent): SearchSliceState {
  switch (ev.type) {
    case "embed:start":
      return { ...s, embed: { ...s.embed, state: "active" } };
    case "embed:done":
      return {
        ...s,
        embed: {
          ...s.embed,
          state: "done",
          ms: ev.ms,
          queryNorm: ev.queryNorm,
          qPreview: ev.qPreview,
          qVec: ev.qVec,
          qStats: ev.qStats,
        },
        score: { ...s.score, state: "active" },
      };
    case "centroids:scored":
      return {
        ...s,
        score: {
          state: "done",
          ms: ev.ms,
          cellScores: ev.cellScores,
          probedCells: ev.probedCells,
        },
        build: { ...s.build, state: "active" },
      };
    case "query:built":
      return {
        ...s,
        build: {
          state: "done",
          dsl: ev.dsl,
          termCount: ev.termCount,
        },
        fetch: { ...s.fetch, state: "active" },
      };
    case "page:start":
      return s;
    case "page:done":
      return {
        ...s,
        fetch: {
          ...s.fetch,
          state: "active",
          pages: [
            ...s.fetch.pages,
            {
              idx: ev.pageIdx,
              count: ev.entities,
              total: ev.totalCandidates,
              ms: ev.ms,
              hasMore: ev.hasMore,
            },
          ],
          candidates: ev.totalCandidates,
        },
      };
    case "done":
      return {
        ...s,
        running: false,
        fetch: { ...s.fetch, state: "done", ms: ev.stats.fetchMs },
        rerank: { state: "done", ms: ev.stats.rerankMs },
        group: { state: "done" },
        done: { state: "done", stats: ev.stats },
        results: ev.results,
        groups: ev.groups,
      };
    default:
      return s;
  }
}

export interface UseSearchArgs {
  api: ApiClient | null;
  manifest: Manifest | null;
  centroids: Float32Array | null;
  tq: TurboQuant | null;
}

export function useSearch({ api, manifest, centroids, tq }: UseSearchArgs) {
  const [state, dispatch] = useReducer(reducer, INITIAL);

  const run = useCallback(
    async (queryText: string, k: number, nprobe: number) => {
      if (!api || !manifest || !centroids || !tq) return;
      dispatch({ type: "start", queryText });
      try {
        await searchShared(api, manifest, centroids, tq, queryText, {
          k,
          nprobe,
          onEvent: (ev) => {
            dispatch({ type: "ev", ev });
          },
        });
      } catch (e) {
        dispatch({ type: "error", message: (e as Error).message });
      }
    },
    [api, manifest, centroids, tq],
  );

  return { ...state, run };
}

export type SearchSlice = ReturnType<typeof useSearch>;
