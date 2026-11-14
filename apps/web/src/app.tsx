import type { ApiClient } from "@neurons/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
import { Link, Navigate, Route, Routes } from "react-router";
import { Button } from "@/shared/ui/button";
import { Layout } from "@/shell/layout";
import { WorkspaceProvider } from "@/workspace/resources";
import { NewProjectPage } from "@/graphs/new-project-page";
import { EmptyState, LoadingRows } from "@/shared/states";
import { ApiProvider } from "@/shared/api";
import { GraphsPage } from "@/graphs/graphs-page";
import { RunsPage } from "@/runs/runs-page";
import { OrganizationsPage } from "@/accounts/organizations-page";
import { RunnersPage } from "@/runners/runners-page";
import { SettingsPage } from "@/settings/settings-page";

// Heavy routes load on demand: the graph editor (React Flow, roughjs) and the run detail (xterm).
const GraphEditorPage = lazy(() =>
  import("@/graphs/graph-editor-page").then((m) => ({ default: m.GraphEditorPage })),
);
const RunDetailPage = lazy(() =>
  import("@/runs/run-detail-page").then((m) => ({ default: m.RunDetailPage })),
);

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
        <WorkspaceProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Navigate to="/graphs" replace />} />
              <Route path="new" element={<NewProjectPage />} />
              <Route path="graphs" element={<GraphsPage />} />
              <Route
                path="graphs/:id"
                element={
                  <Suspense fallback={<LoadingRows label="Carregando projeto" rows={4} />}>
                    <GraphEditorPage />
                  </Suspense>
                }
              />
              <Route path="runs" element={<RunsPage />} />
              <Route
                path="runs/:id"
                element={
                  <Suspense fallback={<LoadingRows label="Carregando execução" rows={4} />}>
                    <RunDetailPage />
                  </Suspense>
                }
              />
              <Route path="organizations" element={<OrganizationsPage />} />
              <Route path="runners" element={<RunnersPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route
                path="*"
                element={
                  <EmptyState
                    title="Página não encontrada"
                    hint="O endereço não existe ou foi movido."
                    action={
                      <Button asChild variant="outline">
                        <Link to="/graphs">Ir para Meus projetos</Link>
                      </Button>
                    }
                  />
                }
              />
            </Route>
          </Routes>
        </WorkspaceProvider>
      </QueryClientProvider>
    </ApiProvider>
  );
}
