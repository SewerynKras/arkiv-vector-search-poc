// Manifest step body: the index meta in compact form. This is the data
// that's baked into the public manifest entity and the same numbers
// everyone querying the index gets.

import type { Manifest } from "@arkiv-search/shared/schema";

import { KvList, type KvRow } from "@/features/stepper/kv-list";

export function ManifestBody({ manifest }: { manifest: Manifest | null }) {
  if (!manifest) {
    return <span className="italic">loading manifest…</span>;
  }
  const rows: KvRow[] = [
    { k: "N (passages)", v: manifest.N_chunks.toLocaleString() },
    { k: "C (clusters)", v: manifest.C.toLocaleString() },
    { k: "M (multi-assignment)", v: manifest.M },
    { k: "dim", v: manifest.dim },
    { k: "nprobe (default)", v: manifest.nprobe_default },
    { k: "model", v: manifest.model_id.split("/").pop() ?? manifest.model_id },
    { k: "corpus", v: manifest.corpus_name },
    {
      k: "built at",
      v: new Date(manifest.built_at).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    },
  ];
  return <KvList rows={rows} />;
}
