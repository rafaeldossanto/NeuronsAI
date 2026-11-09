export interface MemoryItem {
  id: string;
  name: string;
  storage: "local" | "server";
  vaultPath?: string;
  runner?: string;
  fileCount: number;
  createdAt: string;
}
