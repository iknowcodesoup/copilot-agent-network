"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

/*
 * Built in state, not at module scope: a module-level QueryClient is shared by
 * every request the server renders, which leaks one user's cache into another's.
 * useState runs the initializer once per client mount, which is what we want.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // pipeline state changes on the server's schedule, not ours, so a
            // remount should not refetch everything
            staleTime: 5_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
