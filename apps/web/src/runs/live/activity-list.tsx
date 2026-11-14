import { Network, Wrench } from "lucide-react";
import { formatTime } from "@/shared/format";
import type { ActivityDraft, ActivityItem } from "./activity";
import { messageKindLabel } from "./labels";

const TOOL_LABELS: Record<string, string> = {
  obsidian_search: "Buscar notas",
  obsidian_read: "Ler nota",
  obsidian_links: "Seguir links",
  obsidian_create: "Criar nota",
  obsidian_edit: "Editar nota",
};

/**
 * The run's timeline: messages between agents and tool calls (memories included) in one list. A tool
 * call shows its operation and path, never the content of a note.
 */
export function ActivityList({
  items,
  empty,
  drafts = [],
}: {
  items: ActivityItem[];
  empty: string;
  /** What agents are writing now: shown after the last entry, until the final message replaces it. */
  drafts?: ActivityDraft[];
}) {
  if (items.length === 0 && drafts.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        {empty}
      </p>
    );
  }
  return (
    <ol className="flex flex-col gap-2">
      {items.map((item) =>
        item.type === "message" ? (
          <li key={`m${item.seq}`} className="rounded-md border bg-card px-4 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-x-3">
              <span className="font-mono text-xs text-muted-foreground">#{item.seq}</span>
              <span className="font-bold">
                {item.from} → {item.to}
              </span>
              <span className="text-muted-foreground">{messageKindLabel[item.kind]}</span>
              <span className="ml-auto text-xs text-muted-foreground">{formatTime(item.at)}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap">{item.preview}</p>
          </li>
        ) : (
          <ToolRow key={`t${item.seq}`} call={item} />
        ),
      )}
      {drafts.map((draft) => (
        <DraftRow key={`d${draft.agent}:${draft.turnId}`} draft={draft} />
      ))}
    </ol>
  );
}

function ToolRow({ call }: { call: Extract<ActivityItem, { type: "tool" }> }) {
  const memory = call.tool.startsWith("obsidian_");
  const Icon = memory ? Network : Wrench;
  return (
    <li className="flex items-start gap-3 rounded-md border bg-card px-4 py-3 text-sm">
      <Icon aria-label={memory ? "Memória" : "Ferramenta"} className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap gap-x-3">
          <strong>{TOOL_LABELS[call.tool] ?? call.tool}</strong>
          {call.agent && <span>@{call.agent}</span>}
          <span className={call.ok ? "text-muted-foreground" : "text-destructive"}>
            {call.ok ? "Concluída" : "Falhou"}
            {call.durationMs !== null && ` · ${call.durationMs} ms`}
          </span>
          <time className="ml-auto text-xs text-muted-foreground">{formatTime(call.at)}</time>
        </div>
        {call.path && <p className="mt-1 break-words text-muted-foreground">{call.path}</p>}
        {call.errorCode && <p className="mt-1 text-destructive">{call.errorCode}</p>}
      </div>
    </li>
  );
}

/**
 * A text still being written. The final message replaces a message draft; the free text is only
 * ever on screen (it is not part of what the agents say to each other).
 */
export function DraftRow({ draft }: { draft: ActivityDraft }) {
  const message = draft.channel === "message";
  return (
    <li
      aria-label={`${message ? "Mensagem" : "Texto"} de ${draft.agent} em escrita`}
      className="rounded-md border border-dashed bg-card px-4 py-2 text-sm"
    >
      <div className="flex flex-wrap items-center gap-x-3">
        <span className="font-bold">@{draft.agent}</span>
        <span className="text-muted-foreground">
          {message ? "mensagem" : "texto do modelo (não vai para os outros agentes)"}
        </span>
        {draft.writing ? (
          <span
            role="status"
            className="ml-auto flex items-center gap-1 text-xs text-muted-foreground"
          >
            <span
              aria-hidden
              className="inline-block size-2 animate-pulse rounded-full bg-primary"
            />
            Escrevendo…
          </span>
        ) : (
          <span className="ml-auto text-xs text-muted-foreground">Última fala</span>
        )}
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words">
        {draft.cut && "… "}
        {draft.body}
      </p>
    </li>
  );
}
