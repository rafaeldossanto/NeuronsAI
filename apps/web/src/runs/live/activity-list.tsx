import { Network, Wrench } from "lucide-react";
import { formatTime } from "@/shared/format";
import type { ActivityItem } from "./activity";
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
export function ActivityList({ items, empty }: { items: ActivityItem[]; empty: string }) {
  if (items.length === 0) {
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
