// Smoke-test reading from Arkiv via the new RPC client + scope clause + $creator filter.
//
//   pnpm --filter @arkiv-search/server exec tsx src/smoke-arkiv.ts "query text"

import { createArkivClient } from '@arkiv-search/shared/arkiv-rpc-client';
import { bootstrap, search } from '@arkiv-search/shared/search';

async function main() {
  const queryText = process.argv.slice(2).join(' ').trim() || 'who composed the four seasons';
  const api = createArkivClient(); // defaults: BRAGA_RPC_URL, CREATOR_WALLET_ADDRESS
  console.log(`Bootstrapping from ${api.endpoint} …`);
  const t0 = Date.now();
  const setId = process.env.CENTROID_SET_ID ?? 'ivf-subset';
  const r = await bootstrap(api, { centroidSetId: setId });
  console.log(`  manifest: model=${r.manifest.model_id} set=${r.manifest.centroid_set_id} N=${r.manifest.N_chunks} C=${r.manifest.C} M=${r.manifest.M}`);
  console.log(`  centroids loaded: ${r.C}, bootstrap ${Date.now() - t0}ms`);

  console.log(`\nQuery: ${JSON.stringify(queryText)}`);
  const { groups, stats } = await search(api, r.manifest, r.centroids, queryText, { k: 5 });
  console.log(`probed cells: [${stats.probedCells.join(', ')}]`);
  console.log(`pages: ${stats.pages}, candidates: ${stats.candidates}`);
  console.log(`timings: embed=${stats.embedMs}ms fetch+rerank=${stats.fetchMs}ms total=${stats.totalMs}ms`);

  console.log(`\nTop ${groups.length} articles:`);
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]!;
    const head = g.chunks[0]!;
    console.log(`\n[${i + 1}] ${g.title}  (best=${head.score.toFixed(4)})`);
    console.log(`    ${g.url}`);
    for (const c of g.chunks) {
      const text = c.text.length > 160 ? c.text.slice(0, 160) + '…' : c.text;
      console.log(`    · ${c.score.toFixed(4)}  ${text}`);
    }
    const hidden = g.totalInGroup - g.chunks.length;
    if (hidden > 0) console.log(`    + ${hidden} more passage${hidden === 1 ? '' : 's'}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
