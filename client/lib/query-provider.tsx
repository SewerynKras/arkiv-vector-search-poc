"use client";

// One QueryClient instance per page lifetime. Created lazily inside a ref so
// it survives strict-mode double-renders and isn't re-instantiated across
// re-renders of the provider tree.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // The data we cache (Wikipedia summaries) is effectively static, so
        // we never auto-refresh. Garbage-collect a generous hour after the
        // last component unmounts.
        staleTime: Infinity,
        gcTime: 60 * 60 * 1000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(makeClient);
  return (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
