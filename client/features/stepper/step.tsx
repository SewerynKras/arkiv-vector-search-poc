"use client";

// One row in the right-column stepper. Header is always visible (state
// bullet + label + ms); the body collapses. Used for both bootstrap and
// search steps — they're structurally identical.

import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { StepState } from "@/features/bootstrap/use-bootstrap";

export interface StepProps {
  label: string;
  tip: string;
  state: StepState;
  ms?: number;
  children?: React.ReactNode;
  /** Default-expanded state. Stepper controller can also imperatively expand all. */
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Step({
  label,
  tip,
  state,
  ms,
  children,
  defaultOpen,
  open: controlledOpen,
  onOpenChange,
}: StepProps) {
  // Controlled-vs-uncontrolled: Collapsible accepts either; we pass through.
  const [uncontrolledOpen, setUncontrolledOpen] = useState(
    defaultOpen ?? false,
  );
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="group relative"
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={() => setOpen(!open)}
              className="relative grid w-full grid-cols-[22px_1fr_auto] items-center gap-2 py-1.5 text-left text-sm"
            />
          }
        >
          <Bullet state={state} />
          <span
            className={cn(
              "flex items-center gap-1.5 leading-tight",
              state === "pending" && "text-muted-foreground",
              state === "error" && "text-destructive",
            )}
          >
            <ChevronRight
              className={cn(
                "size-3 text-muted-foreground transition-transform",
                open && "rotate-90",
              )}
            />
            {label}
          </span>
          <StepTimer
            active={state === "active"}
            finalMs={state === "done" || state === "error" ? ms : undefined}
          />
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-xs whitespace-normal">
          {tip}
        </TooltipContent>
      </Tooltip>

      <CollapsibleContent>
        <div className="ml-[22px] pb-2 pl-3 text-xs text-muted-foreground">
          {children ?? <span className="italic">—</span>}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

/** Renders the right-hand ms column. While `active`, updates the text via
 * requestAnimationFrame writing directly into the DOM ref — never triggers
 * a React render — so we get a smooth ticking counter without flooding the
 * parent tree with state updates. */
function StepTimer({
  active,
  finalMs,
}: {
  active: boolean;
  finalMs?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!active) return;
    const start = Date.now();
    let raf = 0;
    const tick = () => {
      const el = ref.current;
      if (el) el.textContent = formatMs(Date.now() - start);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [active]);

  if (typeof finalMs === "number") {
    return (
      <span className="font-mono text-[11px] text-muted-foreground">
        {formatMs(finalMs)}
      </span>
    );
  }
  if (active) {
    return (
      <span
        ref={ref}
        className="font-mono text-[11px] tabular-nums text-primary"
      >
        0ms
      </span>
    );
  }
  return <span />;
}

function Bullet({ state }: { state: StepState }) {
  return (
    <span
      data-state={state}
      className={cn(
        "relative ml-1.5 size-2.5 rounded-full border-[1.5px] transition-all",
        state === "pending" && "border-border bg-background",
        state === "active" &&
          "animate-pulse border-primary bg-primary ring-4 ring-primary/20",
        state === "done" && "border-primary bg-primary",
        state === "error" && "border-destructive bg-destructive",
      )}
    />
  );
}
