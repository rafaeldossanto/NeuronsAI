import {
  createContext,
  useCallback,
  lazy,
  Suspense,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi, unwrap } from "@/shared/api";
import { ConnectionsPanel } from "@/connections/connections-panel";
import type { MemoryItem } from "@/memories/types";

// The panel pulls in the ZIP importer (fflate): load it only when someone adds a memory.
const AddMemoryPanel = lazy(() =>
  import("@/memories/memory-panel").then((m) => ({ default: m.AddMemoryPanel })),
);

function useResources() {
  const api = useApi();
  const client = useQueryClient();
  const memories = useQuery({
    queryKey: ["memories"],
    queryFn: ({ signal }) => unwrap(api.GET("/memories", { signal })).then((data) => data.items),
  });
  const connections = useQuery({
    queryKey: ["connections"],
    queryFn: ({ signal }) => unwrap(api.GET("/connections", { signal })),
    staleTime: 10_000,
  });
  const secrets = useQuery({
    queryKey: ["secret-names"],
    queryFn: ({ signal }) => unwrap(api.GET("/secrets", { signal })).then((data) => data.names),
  });
  const refresh = useCallback(async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["memories"] }),
      client.invalidateQueries({ queryKey: ["connections"] }),
      client.invalidateQueries({ queryKey: ["secret-names"] }),
    ]);
  }, [client]);
  return { api, memories, connections, secrets, refresh };
}

type Resources = ReturnType<typeof useResources> & {
  openConnections(): void;
  addMemory(onCreated: (memory: MemoryItem) => void): void;
};
const Context = createContext<Resources | null>(null);
export const useWorkspace = () => useContext(Context);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { api, memories, connections, secrets, refresh } = useResources();
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [memoryCallback, setMemoryCallback] = useState<((memory: MemoryItem) => void) | null>(null);
  const value = useMemo<Resources>(
    () => ({
      api,
      memories,
      connections,
      secrets,
      refresh,
      openConnections: () => setConnectionsOpen(true),
      addMemory: (callback) => setMemoryCallback(() => callback),
    }),
    [api, memories, connections, secrets, refresh],
  );
  return (
    <Context.Provider value={value}>
      {children}
      {connectionsOpen && <ConnectionsPanel onClose={() => setConnectionsOpen(false)} />}
      {memoryCallback && (
        <Suspense fallback={null}>
          <AddMemoryPanel
            onClose={() => setMemoryCallback(null)}
            onCreated={(memory) => {
              memoryCallback(memory);
              setMemoryCallback(null);
            }}
          />
        </Suspense>
      )}
    </Context.Provider>
  );
}
