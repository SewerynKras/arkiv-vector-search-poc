// The bootstrap half of the right-column stepper. Each step's open state is
// controlled by the parent Stepper so the expand-all chip can flip them all.

import type { BootstrapState } from "@/features/bootstrap/use-bootstrap";
import { ConnectBody } from "@/features/stepper/bodies/connect-body";
import { ModelBody } from "@/features/stepper/bodies/model-body";
import { ManifestBody } from "@/features/stepper/bodies/manifest-body";
import { CentroidsBody } from "@/features/stepper/bodies/centroids-body";
import { Step } from "@/features/stepper/step";
import { STEP_TIPS } from "@/features/stepper/step-tips";
import type { OpenMap, ToggleStep } from "@/features/stepper/stepper";

export function BootstrapSection({
  state,
  openMap,
  onToggle,
}: {
  state: BootstrapState;
  openMap: OpenMap;
  onToggle: ToggleStep;
}) {
  return (
    <div className="space-y-0.5">
      <h3 className="ml-[22px] mb-2 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground">
        Bootstrap (once)
      </h3>

      <Step
        label="Connect to source"
        tip={STEP_TIPS.connect}
        state={state.connect.state}
        ms={state.connect.ms}
        open={!!openMap.connect}
        onOpenChange={() => onToggle("connect")}
      >
        <ConnectBody endpoint={state.api?.endpoint ?? null} />
      </Step>

      <Step
        label="Load AI model"
        tip={STEP_TIPS.model}
        state={state.model.state}
        ms={state.model.ms}
        open={!!openMap.model}
        onOpenChange={() => onToggle("model")}
      >
        <ModelBody
          progress={state.model.progress}
          sha256={state.manifest.manifest?.model_sha256}
          error={state.model.error}
        />
      </Step>

      <Step
        label="Fetch manifest"
        tip={STEP_TIPS.manifest}
        state={state.manifest.state}
        ms={state.manifest.ms}
        open={!!openMap.manifest}
        onOpenChange={() => onToggle("manifest")}
      >
        <ManifestBody manifest={state.manifest.manifest} />
      </Step>

      <Step
        label="Fetch centroids"
        tip={STEP_TIPS.centroids}
        state={state.centroids.state}
        ms={state.centroids.ms}
        open={!!openMap.centroids}
        onOpenChange={() => onToggle("centroids")}
      >
        <CentroidsBody
          pages={state.centroids.pages}
          total={state.centroids.total}
          expected={state.centroids.expected}
          state={state.centroids.state}
          fromCache={state.centroids.fromCache}
        />
      </Step>
    </div>
  );
}
