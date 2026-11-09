import { createContext, useContext, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi, unwrap } from "@/shared/api";
import { ConnectionsPanel } from "@/connections/connections-panel";
import { AddMemoryPanel } from "@/memories/memory-panel";
import type { MemoryItem } from "@/memories/types";

function useResources() {
  const api = useApi();
  const client = useQueryClient();
  const memories = useQuery({
    queryKey: ["memories"],
    queryFn: () => unwrap(api.GET("/memories")).then((data) => data.items),
  });
  const connections = useQuery({
    queryKey: ["connections"],
    queryFn: () => unwrap(api.GET("/connections")),
    staleTime: 10_000,
  });
  const secrets = useQuery({
    queryKey: ["secret-names"],
    queryFn: () => unwrap(api.GET("/secrets")).then((data) => data.names),
  });
  return {
    api,
    memories,
    connections,
    secrets,
    refresh: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["memories"] }),
        client.invalidateQueries({ queryKey: ["connections"] }),
        client.invalidateQueries({ queryKey: ["secret-names"] }),
      ]);
    },
  };
}

type Resources = ReturnType<typeof useResources> & {
  openConnections(): void;
  addMemory(onCreated: (memory: MemoryItem) => void): void;
};
const Context = createContext<Resources | null>(null);
export const useWorkspace = () => useContext(Context);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const resources = useResources();
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [memoryCallback, setMemoryCallback] = useState<((memory: MemoryItem) => void) | null>(null);
  return (
    <Context.Provider
      value={{
        ...resources,
        openConnections: () => setConnectionsOpen(true),
        addMemory: (callback) => setMemoryCallback(() => callback),
      }}
    >
      {children}
      {connectionsOpen && <ConnectionsPanel onClose={() => setConnectionsOpen(false)} />}
      {memoryCallback && (
        <AddMemoryPanel
          onClose={() => setMemoryCallback(null)}
          onCreated={(memory) => {
            memoryCallback(memory);
            setMemoryCallback(null);
          }}
        />
      )}
    </Context.Provider>
  );
}
