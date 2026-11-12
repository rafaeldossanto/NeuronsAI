import type { GraphNode } from "@neurons/graph-schema";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  Cloud,
  Network,
  SquareTerminal,
  TriangleAlert,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { formatUsd } from "@/shared/format";
import { cn } from "@/shared/utils";
import { agentStatusLabel, type AgentLiveStatus } from "@/runs/live";

/** What a running agent shows on its block (the read-only run view). */
export interface BlockLive {
  status: AgentLiveStatus;
  /** `null`: no turn reported a price (unknown is never shown as $0). */
  costUsd: number | null;
  /** True when some turns had no price, so `costUsd` is a lower bound. */
  costIsMinimum: boolean;
}

export interface BlockData extends Record<string, unknown> {
  node: GraphNode;
  /** Messages of the validation issues on this block (empty: valid). */
  issues: string[];
  /** Present only in the run view. */
  live?: BlockLive | undefined;
}

export type BlockNode = Node<BlockData>;

const TRIGGER_LABELS = {
  manual: "Manual",
  webhook: "Webhook",
  schedule: "Agenda",
  whatsapp: "WhatsApp",
} as const;

function describe(node: GraphNode): {
  icon: LucideIcon;
  kindLabel: string;
  title: string;
  detail: string;
} {
  switch (node.type) {
    case "agent":
      return node.runtime.kind === "api"
        ? {
            icon: Cloud,
            kindLabel: "Agente · API",
            title: node.name,
            detail: node.runtime.model || "Modelo não definido",
          }
        : {
            icon: SquareTerminal,
            kindLabel: "Agente · Terminal",
            title: node.name,
            detail: node.runtime.cli,
          };
    case "tool":
      return node.tool.kind === "obsidian"
        ? {
            icon: Network,
            kindLabel: "Memória",
            title: node.name,
            detail: `${node.tool.memoryId ? "Memória cadastrada" : "Cofre local"} · ${node.tool.readOnly ? "somente leitura" : "leitura e escrita"}`,
          }
        : {
            icon: Wrench,
            kindLabel: "Ferramenta",
            title: node.name,
            detail: node.tool.kind === "whatsapp" ? "WhatsApp (resposta)" : node.tool.kind,
          };
    case "trigger":
      return {
        icon: Zap,
        kindLabel: "Gatilho",
        title: TRIGGER_LABELS[node.kind],
        detail: node.kind === "schedule" ? (node.cron ?? "") : "",
      };
  }
}

function Block({ data, selected }: NodeProps<BlockNode>) {
  const { node, issues, live } = data;
  const { icon: Icon, kindLabel, title, detail } = describe(node);
  const invalid = issues.length > 0;
  return (
    <div
      data-testid={`block-${node.id}`}
      data-invalid={invalid || undefined}
      data-status={live?.status}
      className={cn(
        "w-52 rounded-lg border bg-card px-3 py-2.5 shadow-sm",
        node.type === "trigger" && "rounded-full px-4",
        selected && "border-accent ring-2 ring-accent/60",
        invalid && "border-destructive",
        live?.status === "busy" && "border-accent",
        live?.status === "failed" && "border-destructive",
        live?.status === "finished" && "opacity-70",
      )}
    >
      {node.type !== "trigger" && (
        <Handle type="target" position={Position.Left} aria-label="Entrada" />
      )}
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-md bg-muted",
            node.type === "agent" && "bg-primary text-primary-foreground",
          )}
        >
          <Icon aria-hidden className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            {kindLabel}
          </p>
          <p className="truncate text-sm font-extrabold">{title || "Sem nome"}</p>
        </div>
        {invalid && (
          <span
            role="img"
            aria-label={`${issues.length} problema${issues.length > 1 ? "s" : ""}`}
            title={issues.join("\n")}
            className="text-destructive"
          >
            <TriangleAlert aria-hidden className="size-4" />
          </span>
        )}
      </div>
      {detail && node.type !== "trigger" && (
        <p className="mt-1.5 truncate text-xs text-muted-foreground">{detail}</p>
      )}
      {live && <LiveBadge live={live} />}
      {node.type !== "tool" && (
        <Handle type="source" position={Position.Right} aria-label="Saída" />
      )}
    </div>
  );
}

const DOT: Record<AgentLiveStatus, string> = {
  starting: "bg-muted-foreground/50",
  busy: "bg-accent",
  idle: "bg-foreground/70",
  waiting_reply: "border border-accent bg-card",
  failed: "bg-destructive",
  finished: "bg-muted-foreground/50",
};

/** Agent state and cost on the block. The amber dot breathes only while the agent works. */
function LiveBadge({ live }: { live: BlockLive }) {
  const working = live.status === "busy" || live.status === "waiting_reply";
  return (
    <div className="mt-2 flex items-center gap-1.5 border-t pt-1.5 text-xs">
      <span
        aria-hidden
        className={cn("size-2 shrink-0 rounded-full", DOT[live.status])}
        style={working ? { animation: "pulse-amber 1.4s ease-in-out infinite" } : undefined}
      />
      <span className="font-bold">{agentStatusLabel[live.status]}</span>
      <span className="ml-auto text-muted-foreground">
        {live.costUsd === null
          ? "custo desconhecido"
          : `${live.costIsMinimum ? "≥ " : ""}${formatUsd(live.costUsd)}`}
      </span>
    </div>
  );
}

export const nodeTypes = { agent: Block, tool: Block, trigger: Block };
