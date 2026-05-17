// Compact key:value grid used inside several step bodies (connect, model,
// done, etc). Keys are monospace muted; values left-align in the right column.

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface KvRow {
  k: string;
  v: ReactNode;
  /** Optional tone for the value text. */
  tone?: "default" | "ok" | "warn" | "accent";
}

export function KvList({ rows }: { rows: KvRow[] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-3.5 gap-y-1 font-mono text-[11.5px]">
      {rows.map(({ k, v, tone }, i) => (
        <Row key={`${k}-${i}`} k={k} v={v} tone={tone} />
      ))}
    </dl>
  );
}

function Row({ k, v, tone = "default" }: KvRow) {
  return (
    <>
      <dt className="text-muted-foreground">{k}</dt>
      <dd
        className={cn(
          "text-foreground/80",
          // Map "ok" / "warn" / "accent" to brand tokens so the whole UI
          // stays Arkiv-blue / Arkiv-orange and we never reach for a stray
          // tailwind hue.
          tone === "ok" && "text-primary",
          tone === "warn" && "text-accent",
          tone === "accent" && "text-primary",
        )}
      >
        {v}
      </dd>
    </>
  );
}
