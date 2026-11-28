import {
  useInfiniteQuery,
  useIsMutating,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { unwrap, useApi } from "@/shared/api";

export const CHAT_IMAGE_LIMIT = 5 * 1024 * 1024;
const PAGE_SIZE = 20;
const turnsPath = "/graphs/{id}/agent-chats/{agentId}/turns";

export interface ChatImage {
  file: File;
  mediaType: "image/png" | "image/jpeg";
}

export const isActiveTurn = (status?: string) => status === "pending" || status === "running";
export const chatKey = (id: string, agentId: string) => ["agent-chats", id, agentId];

export function useChatTurns(id: string, agentId: string) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: chatKey(id, agentId),
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) =>
      unwrap(
        api.GET(turnsPath, {
          signal,
          params: { path: { id, agentId }, query: { limit: PAGE_SIZE, offset: pageParam } },
        }),
      ),
    getNextPageParam: (lastPage, _pages, offset) =>
      lastPage.hasMore ? offset + lastPage.items.length : undefined,
    // The socket normally invalidates history on finish; polling also covers a lost connection.
    refetchInterval: ({ state }) =>
      state.data?.pages[0]?.items.some((turn) => isActiveTurn(turn.status)) ? 1_500 : false,
  });
}

function encodeImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const unreadable = () => reject(new Error("Não foi possível ler a imagem selecionada."));
    reader.onerror = unreadable;
    reader.onabort = unreadable;
    reader.onload = () => {
      if (typeof reader.result !== "string") return unreadable();
      resolve(reader.result.slice(reader.result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function useSendChatTurn(id: string, agentId: string) {
  const api = useApi();
  const client = useQueryClient();
  const mutationKey = [...chatKey(id, agentId), "send"];
  const sending = useIsMutating({ mutationKey, exact: true }) > 0;
  const send = useMutation({
    mutationKey,
    mutationFn: async ({ body, image }: { body: string; image: ChatImage | null }) =>
      unwrap(
        api.POST(turnsPath, {
          params: { path: { id, agentId } },
          body: {
            body,
            ...(image && {
              image: {
                name: image.file.name,
                mediaType: image.mediaType,
                base64: await encodeImage(image.file),
              },
            }),
          },
        }),
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: chatKey(id, agentId), exact: true });
    },
  });
  return { send, sending };
}
