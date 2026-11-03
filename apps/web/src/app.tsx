import type { ApiClient } from "@neurons/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate, Route, Routes } from "react-router";
import { Layout } from "@/components/layout";
import { EmptyState } from "@/components/states";
import { ApiProvider } from "@/lib/api";
import { GraphEditorPage } from "@/routes/graph-editor-page";
import { GraphsPage } from "@/routes/graphs-page";
import { RunDetailPage } from "@/routes/run-detail-page";
import { RunsPage } from "@/routes/runs-page";

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 5_000, refetchOnWindowFocus: false } },
  });
}

/** Providers + routes; the router itself (browser or memory) is supplied by the caller. */
export function App({ api, queryClient }: { api: ApiClient; queryClient?: QueryClient }) {
  const [client] = useState(() => queryClient ?? createQueryClient());
  return (
    <ApiProvider api={api}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/graphs" replace />} />
            <Route path="graphs" element={<GraphsPage />} />
            <Route path="graphs/:id" element={<GraphEditorPage />} />
            <Route path="runs" element={<RunsPage />} />
            <Route path="runs/:id" element={<RunDetailPage />} />
            <Route path="*" element={<EmptyState title="Página não encontrada" />} />
          </Route>
        </Routes>
      </QueryClientProvider>
    </ApiProvider>
  );
}
