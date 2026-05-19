// Smoke-test the Arkiv read path: bootstrap the index, fire one search,
// print the top articles. Useful to verify a fresh publish or to debug
// the chain without a browser in the loop.
//
//   pnpm run smoke:arkiv "query text"

import { createArkivClient } from "@arkiv-search/shared/arkiv-rpc-client";
import { bootstrap, search } from "@arkiv-search/shared/search";

async function main() {
  const queryText =
    process.argv.slice(2).join(" ").trim() || "who composed the four seasons";
  const api = createArkivClient(); // defaults: BRAGA_RPC_URL, CREATOR_WALLET_ADDRESS
  console.log(`Bootstrapping from ${api.endpoint} …`);
  const t0 = Date.now();
  const setId = process.env.CENTROID_SET_ID ?? "ivf-v2";
  const r = await bootstrap(api, { centroidSetId: setId });
  console.log(
    `  manifest: model=${r.manifest.model_id} set=${r.manifest.centroid_set_id} N=${r.manifest.N_chunks} C=${r.manifest.C} M=${r.manifest.M} quant=${r.manifest.emb_quant}`,
  );
  console.log(
    `  centroids loaded: ${r.C}, tq: dim=${r.manifest.tq_dim} seed=0x${r.manifest.tq_seed.toString(16)}, bootstrap ${Date.now() - t0}ms`,
  );

  console.log(`\nQuery: ${JSON.stringify(queryText)}`);
  const { groups, stats } = await search(
    api,
    r.manifest,
    r.centroids,
    r.tq,
    queryText,
    { k: 5 },
  );
  console.log(`probed cells: [${stats.probedCells.join(", ")}]`);
  console.log(
    `pages: ${stats.pages}, buckets: ${stats.buckets}, candidates: ${stats.candidates}`,
  );
  console.log(
    `timings: embed=${stats.embedMs}ms fetch+rerank=${stats.fetchMs}ms total=${stats.totalMs}ms`,
  );

  console.log(`\nTop ${groups.length} articles:`);
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]!;
    console.log(
      `\n[${i + 1}] score=${g.bestScore.toFixed(4)}  hits=${g.hits}  pid=${g.pid}`,
    );
    console.log(`    ${g.url}`);
  }
  r.tq.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
