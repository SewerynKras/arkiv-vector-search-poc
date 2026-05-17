// Model step body: where the AI model lives, what runtime, and the current
// status text. Status text is the only thing that changes during loading.

import type { ModelProgress } from "@arkiv-search/shared/embedding";

import { KvList, type KvRow } from "@/features/stepper/kv-list";

export function ModelBody({
  progress,
  sha256,
  error,
}: {
  progress: ModelProgress | null;
  sha256?: string;
  error?: string;
}) {
  const statusText = error ? `error: ${error}` : describeProgress(progress);
  const rows: KvRow[] = [
    { k: "model", v: "Xenova/bge-small-en-v1.5" },
    { k: "runtime", v: "onnxruntime-web (q8)" },
    { k: "pooling", v: "mean + L2 normalize" },
    { k: "dim", v: "384" },
  ];
  if (sha256) {
    rows.push({ k: "sha256", v: `${sha256.slice(0, 12)}…` });
  }
  rows.push({
    k: "status",
    v: statusText,
    tone: error ? "warn" : progress?.status === "ready" ? "ok" : "default",
  });
  return <KvList rows={rows} />;
}

function describeProgress(p: ModelProgress | null): string {
  if (!p) return "waiting…";
  switch (p.status) {
    case "initiate":
    case "download":
      return "starting download…";
    case "progress": {
      const pct = p.progress.toFixed(0);
      const loaded = (p.loaded / 1e6).toFixed(1);
      const total = (p.total / 1e6).toFixed(1);
      return `downloading ${pct}% · ${loaded}/${total} MB`;
    }
    case "done":
      return "extracting weights…";
    case "ready":
      return "ready";
  }
}
