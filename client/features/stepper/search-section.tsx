// The search half of the right-column stepper. Renders the seven per-query
// steps and routes their slice of state into the right body component.

import type { SearchSlice } from "@/features/search/use-search";
import { BuildBody } from "@/features/stepper/bodies/build-body";
import { DoneBody } from "@/features/stepper/bodies/done-body";
import { EmbedBody } from "@/features/stepper/bodies/embed-body";
import { FetchBody } from "@/features/stepper/bodies/fetch-body";
import { GroupBody } from "@/features/stepper/bodies/group-body";
import { RerankBody } from "@/features/stepper/bodies/rerank-body";
import { ScoreBody } from "@/features/stepper/bodies/score-body";
import { Step } from "@/features/stepper/step";
import { STEP_TIPS } from "@/features/stepper/step-tips";
import type { OpenMap, ToggleStep } from "@/features/stepper/stepper";

export function SearchSection({
  search,
  centroidKeys,
  openMap,
  onToggle,
}: {
  search: SearchSlice;
  centroidKeys: string[];
  openMap: OpenMap;
  onToggle: ToggleStep;
}) {
  return (
    <div className="space-y-0.5">
      <h3 className="ml-[22px] mt-3 mb-2 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground">
        Per search
      </h3>

      <Step
        label="Embed your query"
        tip={STEP_TIPS.embed}
        state={search.embed.state}
        ms={search.embed.ms}
        open={!!openMap.embed}
        onOpenChange={() => onToggle("embed")}
      >
        <EmbedBody
          queryText={search.embed.queryText}
          qPreview={search.embed.qPreview}
          qStats={search.embed.qStats}
          queryNorm={search.embed.queryNorm}
        />
      </Step>

      <Step
        label="Score & probe cluster centers"
        tip={STEP_TIPS.score}
        state={search.score.state}
        ms={search.score.ms}
        open={!!openMap.score}
        onOpenChange={() => onToggle("score")}
      >
        <ScoreBody
          cellScores={search.score.cellScores}
          probedCells={search.score.probedCells}
          centroidKeys={centroidKeys}
        />
      </Step>

      <Step
        label="Build Arkiv query"
        tip={STEP_TIPS.build}
        state={search.build.state}
        open={!!openMap.build}
        onOpenChange={() => onToggle("build")}
      >
        <BuildBody dsl={search.build.dsl} termCount={search.build.termCount} />
      </Step>

      <Step
        label="Fetch candidate passages"
        tip={STEP_TIPS.fetch}
        state={search.fetch.state}
        ms={search.fetch.ms}
        open={!!openMap.fetch}
        onOpenChange={() => onToggle("fetch")}
      >
        <FetchBody
          pages={search.fetch.pages}
          candidates={search.fetch.candidates}
        />
      </Step>

      <Step
        label="Rerank candidates"
        tip={STEP_TIPS.rerank}
        state={search.rerank.state}
        ms={search.rerank.ms}
        open={!!openMap.rerank}
        onOpenChange={() => onToggle("rerank")}
      >
        <RerankBody results={search.results} />
      </Step>

      <Step
        label="Group results by article"
        tip={STEP_TIPS.group}
        state={search.group.state}
        open={!!openMap.group}
        onOpenChange={() => onToggle("group")}
      >
        <GroupBody groups={search.groups} />
      </Step>

      <Step
        label="Done"
        tip={STEP_TIPS.done}
        state={search.done.state}
        ms={search.done.stats?.totalMs}
        open={!!openMap.done}
        onOpenChange={() => onToggle("done")}
      >
        <DoneBody stats={search.done.stats} />
      </Step>
    </div>
  );
}
