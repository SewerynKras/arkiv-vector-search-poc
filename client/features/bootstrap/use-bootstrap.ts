"use client";

// Single hook that owns the once-per-page bootstrap lifecycle: the Arkiv RPC
// client, the bge-small embedding model, the index manifest, and the full
// centroid set. Translates streaming bootstrap events from `shared/search.ts`
// into a per-step state slice the right column can render directly.

// Configure transformers.js to load model files from our R2 bucket instead
// of HuggingFace (CORS-blocked at the deployed origin). Side-effect import
// — must run before any getEmbedder() call.
import "@/lib/configure-transformers";

import { useEffect, useMemo, useReducer, useRef } from "react";

import type { ApiClient } from "@arkiv-search/shared/api-client";
import { createArkivClient } from "@arkiv-search/shared/arkiv-rpc-client";
import { bootstrap as bootstrapShared } from "@arkiv-search/shared/search";
import { getEmbedder } from "@arkiv-search/shared/embedding";
import type { ModelProgress } from "@arkiv-search/shared/embedding";
import type { TurboQuant } from "@arkiv-search/shared/quantize";
import type { Manifest } from "@arkiv-search/shared/schema";

import { CENTROID_SET_ID } from "@/features/arkiv/env";
import { loadCentroids, saveCentroids } from "@/lib/centroid-cache";

export type StepState = "pending" | "active" | "done" | "error";

export interface CentroidPage {
  idx: number;
  count: number;
  total: number;
  expected: number;
}

export interface BootstrapState {
  api: ApiClient | null;
  connect: { state: StepState; ms?: number; error?: string };
  model: {
    state: StepState;
    ms?: number;
    progress: ModelProgress | null;
    error?: string;
  };
  manifest: {
    state: StepState;
    ms?: number;
    manifest: Manifest | null;
    error?: string;
  };
  centroids: {
    state: StepState;
    ms?: number;
    centroids: Float32Array | null;
    centroidKeys: string[];
    pages: CentroidPage[];
    total: number;
    expected: number;
    /** Set when the centroid set was served from IndexedDB instead of
     * fetched from chain. The UI uses this to swap the progress text and
     * skip the per-page list (there are no pages to list on a cache hit). */
    fromCache: boolean;
    error?: string;
  };
  quantizer: {
    state: StepState;
    ms?: number;
    tq: TurboQuant | null;
    error?: string;
  };
  ready: boolean;
}

const INITIAL: BootstrapState = {
  api: null,
  connect: { state: "pending" },
  model: { state: "pending", progress: null },
  manifest: { state: "pending", manifest: null },
  centroids: {
    state: "pending",
    centroids: null,
    centroidKeys: [],
    pages: [],
    total: 0,
    expected: 0,
    fromCache: false,
  },
  quantizer: { state: "pending", tq: null },
  ready: false,
};

type Action =
  | { type: "init"; api: ApiClient }
  | { type: "connect:done"; ms: number }
  | { type: "model:progress"; progress: ModelProgress }
  | { type: "model:done"; ms: number }
  | { type: "model:error"; ms: number; message: string }
  | { type: "manifest:start" }
  | { type: "manifest:done"; ms: number; manifest: Manifest }
  | { type: "manifest:error"; ms: number; message: string }
  | { type: "centroids:start"; expected: number }
  | { type: "centroids:page"; page: CentroidPage }
  | { type: "centroids:from-cache"; total: number }
  | {
      type: "centroids:done";
      ms: number;
      centroids: Float32Array;
      centroidKeys: string[];
    }
  | { type: "centroids:error"; ms: number; message: string }
  | { type: "quantizer:start" }
  | { type: "quantizer:done"; ms: number; tq: TurboQuant }
  | { type: "quantizer:error"; ms: number; message: string };

function reducer(s: BootstrapState, a: Action): BootstrapState {
  switch (a.type) {
    case "init":
      return {
        ...s,
        api: a.api,
        connect: { state: "active" },
        model: { ...s.model, state: "active" },
      };
    case "connect:done":
      return { ...s, connect: { state: "done", ms: a.ms } };
    case "model:progress":
      return { ...s, model: { ...s.model, progress: a.progress } };
    case "model:done":
      return { ...s, model: { ...s.model, state: "done", ms: a.ms } };
    case "model:error":
      return {
        ...s,
        model: { ...s.model, state: "error", ms: a.ms, error: a.message },
      };
    case "manifest:start":
      return { ...s, manifest: { ...s.manifest, state: "active" } };
    case "manifest:done":
      return {
        ...s,
        manifest: { state: "done", ms: a.ms, manifest: a.manifest },
      };
    case "manifest:error":
      return {
        ...s,
        manifest: { ...s.manifest, state: "error", ms: a.ms, error: a.message },
      };
    case "centroids:start":
      return {
        ...s,
        centroids: { ...s.centroids, state: "active", expected: a.expected },
      };
    case "centroids:page":
      return {
        ...s,
        centroids: {
          ...s.centroids,
          pages: [...s.centroids.pages, a.page],
          total: a.page.total,
          expected: a.page.expected,
        },
      };
    case "centroids:from-cache":
      return {
        ...s,
        centroids: {
          ...s.centroids,
          fromCache: true,
          total: a.total,
          expected: a.total,
        },
      };
    case "centroids:done":
      return {
        ...s,
        centroids: {
          ...s.centroids,
          state: "done",
          ms: a.ms,
          centroids: a.centroids,
          centroidKeys: a.centroidKeys,
        },
      };
    case "centroids:error":
      return {
        ...s,
        centroids: {
          ...s.centroids,
          state: "error",
          ms: a.ms,
          error: a.message,
        },
      };
    case "quantizer:start":
      return {
        ...s,
        quantizer: { ...s.quantizer, state: "active" },
      };
    case "quantizer:done":
      return {
        ...s,
        quantizer: { state: "done", ms: a.ms, tq: a.tq },
      };
    case "quantizer:error":
      return {
        ...s,
        quantizer: { ...s.quantizer, state: "error", ms: a.ms, error: a.message },
      };
    default:
      return s;
  }
}

export function useBootstrap(): BootstrapState {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  // Strict-mode guard: useEffect runs twice in dev; guard against double-start.
  const ranRef = useRef(false);

  // The API client is determined once at module init. Memoise so it's stable.
  const api = useMemo<ApiClient>(() => createArkivClient(), []);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    dispatch({ type: "init", api });

    // Model load runs in parallel with the manifest/centroids fetch.
    const modelStart = Date.now();
    (async () => {
      try {
        await getEmbedder({
          onProgress: (p) => dispatch({ type: "model:progress", progress: p }),
        });
        dispatch({ type: "model:done", ms: Date.now() - modelStart });
      } catch (e) {
        dispatch({
          type: "model:error",
          ms: Date.now() - modelStart,
          message: (e as Error).message,
        });
      }
    })();

    (async () => {
      let manifestStart = 0;
      let centroidsStart = 0;
      let quantStart = 0;
      try {
        const result = await bootstrapShared(api, {
          centroidSetId: CENTROID_SET_ID,
          cache: { get: loadCentroids, put: saveCentroids },
          events: {
            onManifestStart: () => {
              manifestStart = Date.now();
              dispatch({ type: "manifest:start" });
            },
            onManifestDone: (m) => {
              const ms = Date.now() - manifestStart;
              // First successful round-trip → connect is also done.
              dispatch({ type: "connect:done", ms });
              dispatch({ type: "manifest:done", ms, manifest: m });
              centroidsStart = Date.now();
              dispatch({ type: "centroids:start", expected: m.C });
            },
            onCentroidPage: (idx, count, total, expected) => {
              dispatch({
                type: "centroids:page",
                page: { idx, count, total, expected },
              });
            },
            onCentroidsFromCache: (C) => {
              dispatch({ type: "centroids:from-cache", total: C });
            },
            onQuantizerStart: () => {
              quantStart = Date.now();
              dispatch({ type: "quantizer:start" });
            },
          },
        });
        // bootstrapShared awaits both centroids fetch and TurboQuant.init.
        // Dispatch both completion events from here so the reducer can mark
        // ready in a single render.
        dispatch({
          type: "centroids:done",
          ms: Date.now() - centroidsStart,
          centroids: result.centroids,
          centroidKeys: result.centroidKeys,
        });
        dispatch({
          type: "quantizer:done",
          ms: Date.now() - quantStart,
          tq: result.tq,
        });
      } catch (e) {
        // We don't know which phase failed; mark the still-active one as error.
        const ms = Date.now() - (centroidsStart || manifestStart);
        const message = (e as Error).message;
        if (centroidsStart > 0) dispatch({ type: "centroids:error", ms, message });
        else dispatch({ type: "manifest:error", ms, message });
      }
    })();
  }, [api]);

  // Once model, centroids, and quantizer are all done, search is enabled.
  return state.api &&
    state.model.state === "done" &&
    state.centroids.state === "done" &&
    state.quantizer.state === "done"
    ? { ...state, ready: true }
    : state;
}
