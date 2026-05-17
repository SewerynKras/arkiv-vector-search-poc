// Score step body: the top-N cluster centers ranked by similarity to the
// query. Each row links to its Arkiv entity when the key is hex-format.

import { arkivEntityUrl, shortKey } from "@/features/arkiv/links";

export interface ScoreBodyProps {
  cellScores?: Float32Array;
  probedCells?: number[];
  centroidKeys: string[];
}

interface ScoredCell {
  id: number;
  score: number;
}

export function ScoreBody({
  cellScores,
  probedCells,
  centroidKeys,
}: ScoreBodyProps) {
  if (!cellScores || !probedCells) {
    return <span className="italic text-muted-foreground">waiting…</span>;
  }
  const total = cellScores.length;
  // Build sorted index list, then take more than nprobe so the user can see
  // the boundary between picked and not-picked centroids.
  const indexed: ScoredCell[] = new Array(total);
  for (let i = 0; i < total; i++) indexed[i] = { id: i, score: cellScores[i]! };
  indexed.sort((a, b) => b.score - a.score);
  const TOP = Math.max(probedCells.length, 10);
  const top = indexed.slice(0, TOP);
  const probedSet = new Set(probedCells);

  return (
    <div className="space-y-2">
      <p className="text-[12.5px] text-foreground/80">
        {total.toLocaleString()} cluster centers scored · top{" "}
        {probedCells.length} picked as probes
      </p>
      <ol className="grid gap-1 font-mono text-[11px]">
        {top.map((t, i) => {
          const probed = probedSet.has(t.id);
          const key = centroidKeys[t.id] ?? "";
          const link = arkivEntityUrl(key);
          return (
            <li
              key={t.id}
              className="grid grid-cols-[24px_56px_1fr_auto] items-baseline gap-2"
            >
              <span className="text-muted-foreground">#{i + 1}</span>
              <span className={probed ? "text-primary" : "text-foreground/70"}>
                {t.score.toFixed(3)}
              </span>
              <span
                className="truncate text-muted-foreground"
                title={key || `cell ${t.id}`}
              >
                {probed && <span className="mr-1 text-primary">★</span>}
                cell {t.id}
                {key ? ` · ${shortKey(key)}` : ""}
              </span>
              {link ? (
                <a
                  href={link}
                  target="_blank"
                  rel="noopener"
                  className="text-[10.5px] text-primary hover:underline"
                >
                  view ↗
                </a>
              ) : (
                <span className="text-[10.5px] text-muted-foreground">
                  local
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
