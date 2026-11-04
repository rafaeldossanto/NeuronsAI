import type { GraphNode } from "@neurons/graph-schema";
import { X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatUsd } from "@/lib/format";
import { ActivityList } from "./activity-list";
import { selectActivity } from "./activity";
import { agentStatusLabel } from "./labels";
import type { TerminalInputError } from "./terminal-errors";
import { TerminalView } from "./terminal-view";
import type { RunLiveState } from "./types";

type AgentNode = Extract<GraphNode, { type: "agent" }>;

interface Props {
  name: string;
  /** The agent's block in the graph, when the graph is known. */
  node: AgentNode | undefined;
  state: RunLiveState;
  /** True while the run can still receive input. */
  runActive: boolean;
  inputError: TerminalInputError | null;
  onSendInput: (agent: string, data: string) => boolean;
  onClearInputError: () => void;
  onClose: () => void;
}

/**
 * What one agent is doing. An API agent shows its conversation. A terminal agent in `pty` mode shows
 * its live terminal (xterm.js) where you can type, and then the same conversation under it.
 */
export function AgentPanel({
  name,
  node,
  state,
  runActive,
  inputError,
  onSendInput,
  onClearInputError,
  onClose,
}: Props) {
  const agent = state.agents[name];
  const hasTerminal = node?.runtime.kind === "terminal" && node.runtime.mode === "pty";
  const streamJson = node?.runtime.kind === "terminal" && node.runtime.mode === "stream-json";
  const [notSent, setNotSent] = useState(false);

  const send = (data: string) => {
    onClearInputError();
    setNotSent(!onSendInput(name, data));
  };

  return (
    <section
      aria-label={`Painel do agente ${name}`}
      className="flex flex-col gap-4 rounded-lg border bg-card p-4"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-lg font-bold">@{name}</h2>
        {agent && (
          <span className="text-sm text-muted-foreground">
            {agentStatusLabel[agent.status]} ·{" "}
            {agent.costUsd === null ? "custo desconhecido" : formatUsd(agent.costUsd)}
            {agent.costUsd !== null && agent.unknownCostTurns > 0 && " (ao menos)"} · {agent.turns}{" "}
            turnos
          </span>
        )}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={onClose}
          aria-label="Fechar painel do agente"
        >
          <X className="size-4" />
        </Button>
      </header>
      {agent?.failure && <p className="text-sm text-destructive">Falhou: {agent.failure}</p>}

      {hasTerminal && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-bold">Terminal</h3>
          {state.terminals[name] === undefined && (
            <p className="text-sm text-muted-foreground">
              O terminal abre quando o agente recebe a primeira mensagem.
            </p>
          )}
          <TerminalView
            label={`Terminal de ${name}`}
            output={state.terminals[name] ?? ""}
            meta={state.terminalMeta[name]}
            onInput={send}
            readOnly={!runActive}
          />
          <p className="text-xs text-muted-foreground">
            {runActive
              ? "Clique no terminal e digite: o texto vai direto para o agente. Nada do que você digita fica gravado."
              : "A execução terminou: o terminal fica só para leitura."}
          </p>
          {(inputError || notSent) && (
            <p role="alert" className="text-sm font-semibold text-destructive">
              {inputError?.message ??
                "Sem conexão com o servidor agora. O que você digitou não foi enviado."}
            </p>
          )}
        </div>
      )}
      {streamJson && (
        <p className="text-sm text-muted-foreground">
          Este agente roda em modo stream-json: não tem tela de terminal, só a conversa abaixo.
        </p>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-bold">Conversa</h3>
        <ActivityList
          items={selectActivity(state, name)}
          empty="Este agente ainda não trocou mensagens."
        />
      </div>
    </section>
  );
}
