// Centroids step body — paginated load progress plus a pointer at the
// always-mounted 3D viz that lives below the stepper. We deliberately do
// NOT render the canvas in here: the body is unmounted whenever the step is
// collapsed, which would force a fresh PCA + scene init on every expand
// (~3-8s, terrible UX).

import type {
  CentroidPage,
  StepState,
} from "@/features/bootstrap/use-bootstrap";

export interface CentroidsBodyProps {
  pages: CentroidPage[];
  total: number;
  expected: number;
  state: StepState;
}

export function CentroidsBody({
  pages,
  total,
  expected,
  state,
}: CentroidsBodyProps) {
  return (
    <div className="space-y-2">
      <div className="font-mono text-[11px] text-muted-foreground">
        {state === "pending" && "waiting on manifest…"}
        {state === "active" && (
          <>
            {total.toLocaleString()} / {expected.toLocaleString()} centroids
            loaded
          </>
        )}
        {state === "done" && <>{total.toLocaleString()} centroids loaded</>}
      </div>

      {pages.length > 0 && (
        <div className="space-y-0.5 border-l border-dashed border-border pl-3 font-mono text-[10.5px]">
          {pages.map((p) => (
            <div
              key={p.idx}
              className="flex justify-between gap-2.5 leading-relaxed"
            >
              <span>page {p.idx}</span>
              <span className="text-foreground/80">
                +{p.count} · {p.total} / {p.expected}
              </span>
            </div>
          ))}
        </div>
      )}

      {state === "done" && (
        <p className="text-[11.5px] italic text-muted-foreground">
          ↓ live 3D projection of the centroid space below
        </p>
      )}
    </div>
  );
}
