// The "What's going on" panel header + expand/collapse-all controls.

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function Header({
  onExpandAll,
  onCollapseAll,
}: {
  onExpandAll: () => void;
  onCollapseAll: () => void;
}) {
  return (
    <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
      <span>What&apos;s going on</span>
      <span className="flex-1" />
      <ToggleChip onClick={onExpandAll} tip="Expand every step.">
        expand all
      </ToggleChip>
      <ToggleChip onClick={onCollapseAll} tip="Collapse every step.">
        collapse all
      </ToggleChip>
    </div>
  );
}

function ToggleChip({
  children,
  tip,
  onClick,
}: {
  children: React.ReactNode;
  tip: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={onClick}
            className="rounded-sm border border-border px-2 py-0.5 text-[9.5px] normal-case tracking-wider text-muted-foreground transition-colors hover:border-primary hover:bg-primary/10 hover:text-foreground"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="left">{tip}</TooltipContent>
    </Tooltip>
  );
}
