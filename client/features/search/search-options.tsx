"use client";

// k / nprobe number inputs, with hover tooltips explaining what they do.

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface SearchOptionsProps {
  k: number;
  nprobe: number;
  onChangeK: (k: number) => void;
  onChangeNprobe: (n: number) => void;
}

const K_TIP =
  "How many articles to show. Higher means a longer list of answers.";
const NPROBE_TIP =
  "How many regions of the index to look inside. Higher = more accurate but slower (more pages to fetch). Like deciding to check more shelves before concluding nothing is there.";

export function SearchOptions({
  k,
  nprobe,
  onChangeK,
  onChangeNprobe,
}: SearchOptionsProps) {
  return (
    <div className="mt-2.5 flex items-center gap-5 font-mono text-xs text-muted-foreground">
      <Tooltip>
        <TooltipTrigger
          render={
            <label className="flex cursor-help items-center gap-1.5" />
          }
        >
          k =
          <input
            type="number"
            value={k}
            min={1}
            max={50}
            onChange={(e) => onChangeK(parseClamp(e.target.value, 1, 50, k))}
            className="h-7 w-[60px] rounded-sm border border-input bg-transparent px-2 font-mono text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="start"
          className="max-w-xs whitespace-normal"
        >
          {K_TIP}
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <label className="flex cursor-help items-center gap-1.5" />
          }
        >
          nprobe =
          <input
            type="number"
            value={nprobe}
            min={1}
            max={32}
            onChange={(e) =>
              onChangeNprobe(parseClamp(e.target.value, 1, 32, nprobe))
            }
            className="h-7 w-[60px] rounded-sm border border-input bg-transparent px-2 font-mono text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="start"
          className="max-w-xs whitespace-normal"
        >
          {NPROBE_TIP}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function parseClamp(s: string, min: number, max: number, fallback: number) {
  const n = parseInt(s, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
