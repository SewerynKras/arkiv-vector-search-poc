// Embed step body: the actual query text + interpretable stats about the
// embedding it produced + a mini bar chart of the first 16 dimensions.

import { KvList, type KvRow } from "@/features/stepper/kv-list";

export interface EmbedBodyProps {
  queryText?: string;
  qPreview?: Float32Array;
  qStats?: { min: number; max: number; meanAbs: number };
  queryNorm?: number;
}

export function EmbedBody({
  queryText,
  qPreview,
  qStats,
  queryNorm,
}: EmbedBodyProps) {
  if (!queryText || !qPreview || !qStats || queryNorm === undefined) {
    return <span className="italic text-muted-foreground">waiting…</span>;
  }
  const rows: KvRow[] = [
    {
      k: "query",
      v: <code className="text-foreground">{queryText}</code>,
    },
    { k: "min", v: qStats.min.toFixed(4) },
    { k: "max", v: qStats.max.toFixed(4) },
    { k: "mean |x|", v: qStats.meanAbs.toFixed(4) },
    {
      k: "L2 norm",
      v: (
        <>
          {queryNorm.toFixed(3)}{" "}
          <span className="text-muted-foreground">
            (always 1.0 after normalising)
          </span>
        </>
      ),
    },
  ];

  return (
    <div className="space-y-2">
      <p className="text-[12.5px] text-foreground/80">
        Query → 384 numbers. Each component encodes a different facet of the
        meaning.
      </p>
      <KvList rows={rows} />
      <Bars values={qPreview} />
      <p className="font-mono text-[10.5px] italic text-muted-foreground">
        first {qPreview.length} of 384 dimensions (centered at 0)
      </p>
    </div>
  );
}

function Bars({ values }: { values: Float32Array }) {
  let absMax = 0;
  for (let i = 0; i < values.length; i++) {
    const a = Math.abs(values[i]!);
    if (a > absMax) absMax = a;
  }
  absMax = absMax || 1;
  const cols = `repeat(${values.length}, 1fr)`;
  return (
    <div
      className="relative mt-1 h-[70px] gap-[2px] overflow-hidden rounded-sm border border-border bg-muted/30 p-[2px]"
      style={{ display: "grid", gridTemplateColumns: cols }}
    >
      {/* zero line */}
      <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-border" />
      {Array.from(values).map((v, i) => {
        const h = (Math.abs(v) / absMax) * 50;
        const pos = v >= 0;
        return (
          <div key={i} className="relative h-full">
            <div
              className={
                pos
                  ? "absolute inset-x-[1px] bottom-1/2 rounded-[1px] bg-primary"
                  : "absolute inset-x-[1px] top-1/2 rounded-[1px] bg-accent"
              }
              style={{ height: `${h}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}
