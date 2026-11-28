import type { AgentNode, GraphDefinition } from "@neurons/graph-schema";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Cloud, PanelRight, Paperclip, SquareTerminal, X } from "lucide-react";
import { memo, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { GraphViewer } from "@/graphs/editor/graph-viewer";
import { chatPath, flowPath } from "@/graphs/project-navigation";
import { type RunLiveState, useRunLive } from "@/runs/live";
import { isRecentPulse, liveByNode } from "@/runs/live/graph-activity";
import { pulsesByEdge, useActivePulses } from "@/runs/live/pulse-edges";
import { useRunGraph } from "@/runs/live/run-queries";
import { ApiError } from "@/shared/api";
import { Button } from "@/shared/ui/button";
import {
  CHAT_IMAGE_LIMIT,
  chatKey,
  isActiveTurn,
  type ChatImage,
  useChatTurns,
  useSendChatTurn,
} from "./chat-queries";
import "./project-chats.css";

export function ProjectChats({
  graphId,
  doc,
  agentId,
  canSend = true,
}: {
  graphId: string;
  doc: GraphDefinition;
  agentId?: string | undefined;
  /** Who may only look at the project (no `use`) reads the conversations but cannot send. */
  canSend?: boolean;
}) {
  const agents = doc.nodes.filter((node): node is AgentNode => node.type === "agent");
  const agent = agentId ? agents.find((item) => item.id === agentId) : agents[0];
  const [graphOpen, setGraphOpen] = useState(false);
  const graphPanelId = useId();
  const toggleGraph = () => setGraphOpen((open) => !open);

  useEffect(() => {
    if (!agent) return;
    const keyDown = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "g"
      ) {
        event.preventDefault();
        if (!event.repeat) setGraphOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", keyDown);
    return () => window.removeEventListener("keydown", keyDown);
  }, [agent]);

  return (
    <div className="project-chats">
      <nav aria-label="Agentes do projeto" className="project-chat-agents">
        {agents.map((item) => {
          const Icon = item.runtime.kind === "api" ? Cloud : SquareTerminal;
          return (
            <Link
              key={item.id}
              to={chatPath(graphId, item.id)}
              aria-current={item.id === agent?.id ? "page" : undefined}
              className="project-chat-agent"
              title={item.name}
            >
              <Icon className="size-5 shrink-0" aria-hidden />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </nav>
      {agent ? (
        <AgentChat
          key={agent.id}
          graphId={graphId}
          agent={agent}
          doc={doc}
          canSend={canSend}
          graphOpen={graphOpen}
          graphPanelId={graphPanelId}
          toggleGraph={toggleGraph}
        />
      ) : (
        <div className="project-chat-empty">
          <p>
            {agentId
              ? "Este agente não está no rascunho salvo."
              : "Adicione um agente ao fluxo para conversar com ele aqui."}
          </p>
          <Link className="mt-2 text-foreground underline" to={flowPath(graphId, agentId)}>
            Ver no fluxo
          </Link>
        </div>
      )}
    </div>
  );
}

function AgentChat({
  graphId,
  agent,
  doc,
  canSend: mayRun,
  graphOpen,
  graphPanelId,
  toggleGraph,
}: {
  graphId: string;
  agent: AgentNode;
  doc: GraphDefinition;
  canSend: boolean;
  graphOpen: boolean;
  graphPanelId: string;
  toggleGraph: () => void;
}) {
  const history = useChatTurns(graphId, agent.id);
  const { send, sending } = useSendChatTurn(graphId, agent.id);
  const queryClient = useQueryClient();
  const turns = history.data?.pages.flatMap((page) => page.items) ?? [];
  const latest = turns[0];
  const accepted = send.data?.runId;
  const awaitingHistory = Boolean(accepted && !turns.some((turn) => turn.runId === accepted));
  const runId = (awaitingHistory ? accepted : latest?.runId) ?? "";
  const version = useRunGraph(
    graphOpen && runId ? graphId : undefined,
    awaitingHistory ? undefined : latest?.graphVersionId,
  );
  const { state, connection } = useRunLive(runId);
  const working = awaitingHistory || isActiveTurn(latest?.status);
  const finishedSeq = state.finish?.seq;
  useEffect(() => {
    if (finishedSeq) {
      void queryClient.invalidateQueries({ queryKey: chatKey(graphId, agent.id), exact: true });
    }
  }, [agent.id, finishedSeq, graphId, queryClient]);

  const [body, setBody] = useState("");
  const [image, setImage] = useState<ChatImage | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const supportsImage = agent.runtime.kind === "api";
  const persistedReplies = latest?.runId === runId ? (latest?.replies ?? []) : [];
  const draft = working
    ? (state.drafts[agent.name] ?? [])
        .filter((item) => item.channel === "text")
        .map((item) => item.body)
        .filter(
          (text) =>
            !persistedReplies.some((reply) => reply.text.trimStart().startsWith(text.trim())),
        )
        .join("\n")
    : "";
  const canSend =
    mayRun && !sending && !working && !history.isPending && Boolean(body.trim() || image);

  useEffect(() => {
    if (follow.current && transcript.current) {
      transcript.current.scrollTop = transcript.current.scrollHeight;
    }
  }, [draft, latest?.runId, latest?.replies.length, latest?.status]);

  function selectImage(file: File) {
    setImage(null);
    if (file.type !== "image/png" && file.type !== "image/jpeg") {
      setImageError("Escolha uma imagem PNG ou JPEG.");
      return;
    }
    if (file.size === 0 || file.size > CHAT_IMAGE_LIMIT) {
      setImageError("Escolha uma imagem de até 5 MB com conteúdo.");
      return;
    }
    if (file.name.trim().length === 0 || file.name.trim().length > 255) {
      setImageError("O nome da imagem deve ter entre 1 e 255 caracteres.");
      return;
    }
    setImageError(null);
    setImage({ file, mediaType: file.type });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSend) return;
    follow.current = true;
    send.mutate(
      { body: body.trim(), image },
      {
        onSuccess: () => {
          setBody("");
          setImage(null);
          setImageError(null);
        },
      },
    );
  }

  const publishRequired =
    send.error instanceof ApiError && send.error.code === "chat_publish_required";
  const displayedGraph = runId ? version.data : doc;
  return (
    <>
      <section className="project-chat-conversation" aria-label={`Chat com ${agent.name}`}>
        <header className="project-chat-header">
          <h2 className="min-w-0 truncate text-lg font-semibold" title={agent.name}>
            {agent.name}
          </h2>
          <div className="flex shrink-0 items-center gap-2">
            <Link className="project-chat-flow-link" to={flowPath(graphId, agent.id)}>
              Ver no fluxo
            </Link>
            <Button
              variant="ghost"
              type="button"
              size="icon"
              aria-label="Grafo do fluxo"
              aria-keyshortcuts="Control+G Meta+G"
              aria-expanded={graphOpen}
              aria-controls={graphOpen ? graphPanelId : undefined}
              title="Grafo do fluxo (Ctrl+G)"
              onClick={toggleGraph}
            >
              <PanelRight className="size-4" aria-hidden />
            </Button>
          </div>
        </header>

        <div
          className="project-chat-transcript"
          ref={transcript}
          onScroll={(event) => {
            const box = event.currentTarget;
            follow.current = box.scrollHeight - box.scrollTop - box.clientHeight < 48;
          }}
        >
          <div className="project-chat-messages">
            {history.isPending && <p role="status">Carregando conversa…</p>}
            {history.isError && (
              <div className="text-sm text-muted-foreground">
                <p role="alert">{history.error.message}</p>
                <button
                  type="button"
                  className="mt-2 underline"
                  onClick={() => void history.refetch()}
                >
                  Tentar novamente
                </button>
              </div>
            )}
            {history.hasNextPage && (
              <Button
                variant="ghost"
                size="sm"
                className="self-center"
                disabled={history.isFetching}
                onClick={() => void history.fetchNextPage()}
              >
                {history.isFetchingNextPage ? "Carregando…" : "Mensagens anteriores"}
              </Button>
            )}
            {history.isSuccess && !turns.length && !awaitingHistory && (
              <p className="text-sm text-muted-foreground">Envie uma mensagem para começar.</p>
            )}
            <div role="log" aria-label="Conversa" className="project-chat-messages">
              {turns
                .slice()
                .reverse()
                .map((turn) => (
                  <div key={turn.runId} className="project-chat-turn">
                    <ChatInput body={turn.input} imageName={turn.imageName} />
                    {turn.replies.map((reply) => (
                      <div className="project-chat-reply" key={reply.id}>
                        {reply.text}
                      </div>
                    ))}
                    {turn.error && (
                      <p role="alert" className="text-sm text-destructive">
                        {turn.error}
                      </p>
                    )}
                  </div>
                ))}
              {awaitingHistory && send.variables && (
                <ChatInput body={send.variables.body} imageName={send.variables.image?.file.name} />
              )}
              {draft && <div className="project-chat-reply">{draft}</div>}
            </div>
            {working && (
              <p role="status" className="text-sm text-muted-foreground">
                Aguardando resposta…
              </p>
            )}
            {working && connection === "reconnecting" && (
              <p role="status" className="text-sm text-muted-foreground">
                Reconectando à execução…
              </p>
            )}
          </div>
        </div>

        {!mayRun && (
          <p className="project-chat-form text-sm text-muted-foreground">
            Você só pode ler este projeto: enviar mensagens aos agentes exige poder usá-lo.
          </p>
        )}
        {mayRun && (
          <form className="project-chat-form" onSubmit={submit}>
            {send.error && (
              <p role="alert" className="text-sm text-destructive">
                {send.error.message}{" "}
                {publishRequired && (
                  <Link to={flowPath(graphId, agent.id)} className="underline">
                    Abrir editor do fluxo
                  </Link>
                )}
              </p>
            )}
            {imageError && (
              <p role="alert" className="text-sm text-destructive">
                {imageError}
              </p>
            )}
            {image && (
              <div className="project-chat-file">
                <span className="truncate">{image.file.name}</span>
                <Button
                  variant="ghost"
                  type="button"
                  size="icon"
                  aria-label="Remover imagem"
                  onClick={() => setImage(null)}
                  disabled={sending}
                >
                  <X className="size-4" aria-hidden />
                </Button>
              </div>
            )}
            <div className="project-chat-composer">
              <input
                type="file"
                accept="image/png,image/jpeg"
                aria-label="Selecionar imagem"
                ref={inputRef}
                hidden
                disabled={!supportsImage || sending}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file && supportsImage) selectImage(file);
                  event.currentTarget.value = "";
                }}
              />
              <span
                title={supportsImage ? "Anexar imagem" : "Imagens disponíveis para agentes de API"}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  aria-label="Anexar imagem"
                  disabled={!supportsImage || sending}
                  onClick={() => inputRef.current?.click()}
                >
                  <Paperclip className="size-4" aria-hidden />
                </Button>
              </span>
              <textarea
                rows={1}
                maxLength={100_000}
                aria-label="Mensagem"
                placeholder="Escreva uma mensagem"
                value={body}
                disabled={sending}
                onChange={(event) => setBody(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <Button type="submit" size="icon" aria-label="Enviar mensagem" disabled={!canSend}>
                <ArrowUp className="size-4" aria-hidden />
              </Button>
            </div>
          </form>
        )}
      </section>

      {graphOpen && (
        <aside aria-label="Grafo do fluxo" id={graphPanelId} className="project-chat-graph">
          <header className="project-chat-graph-header">
            <h2 className="text-sm font-semibold">Grafo do fluxo</h2>
            {working && (
              <p role="status" className="ml-auto text-xs text-muted-foreground">
                Em execução
              </p>
            )}
            <Button
              variant="ghost"
              size="icon"
              type="button"
              aria-label="Fechar grafo"
              onClick={toggleGraph}
            >
              <X className="size-4" aria-hidden />
            </Button>
          </header>
          <div className="min-h-0 flex-1">
            {displayedGraph ? (
              <ChatGraph key={runId} doc={displayedGraph} agentId={agent.id} state={state} />
            ) : (
              <p
                role={version.isError ? "alert" : "status"}
                className="p-4 text-sm text-muted-foreground"
              >
                {version.isError
                  ? "Não foi possível carregar o grafo desta execução."
                  : "Carregando grafo…"}
              </p>
            )}
          </div>
        </aside>
      )}
    </>
  );
}

function ChatInput({ body, imageName }: { body: string; imageName?: string | null | undefined }) {
  return (
    <div className="project-chat-input">
      {imageName && (
        <div className="flex items-center gap-2 text-xs font-medium">
          <Paperclip className="size-3 shrink-0" aria-hidden />
          <span className="break-all">{imageName}</span>
        </div>
      )}
      {body && <p>{body}</p>}
    </div>
  );
}

const ChatGraph = memo(function ChatGraph({
  doc,
  agentId,
  state,
}: {
  doc: GraphDefinition;
  agentId: string;
  state: RunLiveState;
}) {
  const moving = useActivePulses(state.pulses, (pulse) => isRecentPulse(state, pulse));
  const recipients = new Set(
    moving.filter((pulse) => pulse.from === "@human").map((pulse) => pulse.to),
  );
  const receiving = new Set(
    doc.nodes.flatMap((node) =>
      node.type === "agent" && recipients.has(node.name) ? [node.id] : [],
    ),
  );
  return (
    <GraphViewer
      doc={doc}
      selectedId={agentId}
      live={liveByNode(doc.nodes, state.agents)}
      pulses={pulsesByEdge(doc, moving)}
      receiving={receiving}
      compact
    />
  );
});
