import { ArkivSearchApp } from "@/features/app-shell/arkiv-search-app";
import { QueryProvider } from "@/lib/query-provider";

export default function Page() {
  return (
    <QueryProvider>
      <ArkivSearchApp />
    </QueryProvider>
  );
}
