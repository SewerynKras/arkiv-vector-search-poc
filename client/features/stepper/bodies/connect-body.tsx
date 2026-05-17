// Connect step body: the static facts about where we read from. Includes a
// clickable link to data.arkiv.network for the trusted creator wallet.

import { CENTROID_SET_ID } from "@/features/arkiv/env";
import { arkivCreatorUrl } from "@/features/arkiv/links";
import { KvList, type KvRow } from "@/features/stepper/kv-list";
import {
  CREATOR_WALLET_ADDRESS,
  PROJECT_ATTRIBUTE,
  PROTOCOL_VERSION,
} from "@arkiv-search/shared/arkiv";

export function ConnectBody({ endpoint }: { endpoint: string | null }) {
  const rows: KvRow[] = [
    { k: "source", v: "Arkiv · Braga", tone: "ok" },
    { k: "endpoint", v: endpoint ?? "—" },
    { k: "centroid_set", v: CENTROID_SET_ID },
    { k: "project", v: PROJECT_ATTRIBUTE.value },
    { k: "protocol", v: PROTOCOL_VERSION },
    {
      k: "$creator filter",
      v: (
        <a
          className="text-primary hover:underline"
          href={arkivCreatorUrl(CREATOR_WALLET_ADDRESS)}
          target="_blank"
          rel="noopener"
          title={CREATOR_WALLET_ADDRESS}
        >
          {`${CREATOR_WALLET_ADDRESS.slice(0, 6)}…${CREATOR_WALLET_ADDRESS.slice(-4)} ↗`}
        </a>
      ),
    },
  ];

  return <KvList rows={rows} />;
}
