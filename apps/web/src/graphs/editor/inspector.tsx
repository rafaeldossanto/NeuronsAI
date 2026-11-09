import {
  peersOf,
  toolsOf,
  type AgentNode,
  type GraphNode,
  type Link,
  type ToolNode,
  type TriggerNode,
} from "@neurons/graph-schema";
import type { ReactNode } from "react";
import { useHasApi } from "@/shared/api";
import { cn } from "@/shared/utils";
import { AgentAccess } from "@/graphs/editor/agent-access";
import { MemoryFields } from "@/graphs/editor/memory-fields";
import { AnnotationInspector } from "./annotation-inspector";
import {
  Field,
  ListField,
  parseOptionalNumber,
  Select,
  TextArea,
  TextInput,
} from "@/shared/ui/fields";
import { issueField, type LocatedIssue } from "./issues";
import { ExternalTriggerPanel, SchedulePreview, TimezoneHint } from "./trigger-panels";
import {
  defaultApiRuntime,
  defaultTerminalRuntime,
  type EditorAction,
  type FieldPath,
  type GraphDoc,
} from "./model";

export interface Selection {
  nodeIds: string[];
  linkIds: string[];
  /** Annotations of the free layer (optional: most callers only select blocks and arrows). */
  annotationIds?: string[];
}

type Dispatch = (action: EditorAction) => void;

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
const CLIS = ["claude", "codex", "gemini", "custom"] as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-extrabold">{title}</h3>
      {children}
    </section>
  );
}

function IssueList({ issues }: { issues: LocatedIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul
      aria-label="Problemas deste item"
      className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive"
    >
      {issues.map((issue, index) => (
        <li key={`${issue.code}-${index}`}>
          {issueField(issue) && <b>{issueField(issue)}: </b>}
          {issue.message}
        </li>
      ))}
    </ul>
  );
}

export function Inspector({
  doc,
  selection,
  issues,
  dispatch,
}: {
  doc: GraphDoc;
  selection: Selection;
  issues: LocatedIssue[];
  dispatch: Dispatch;
}) {
  const annotationIds = selection.annotationIds ?? [];
  const total = selection.nodeIds.length + selection.linkIds.length + annotationIds.length;
  const annotation =
    total === 1 ? doc.annotations.find((a) => a.id === annotationIds[0]) : undefined;
  const node = total === 1 ? doc.nodes.find((n) => n.id === selection.nodeIds[0]) : undefined;
  const link = total === 1 ? doc.links.find((l) => l.id === selection.linkIds[0]) : undefined;

  let body: ReactNode;
  if (node) {
    body = (
      <NodeInspector
        key={node.id}
        doc={doc}
        node={node}
        issues={issues.filter((i) => i.targetNodeId === node.id)}
        dispatch={dispatch}
      />
    );
  } else if (annotation) {
    body = <AnnotationInspector key={annotation.id} annotation={annotation} dispatch={dispatch} />;
  } else if (link) {
    body = (
      <LinkInspector
        key={link.id}
        link={link}
        issues={issues.filter((i) => i.targetLinkId === link.id)}
        dispatch={dispatch}
      />
    );
  } else if (total > 1) {
    body = <p className="text-sm text-muted-foreground">{total} itens selecionados.</p>;
  } else {
    body = (
      <Section title="Grafo">
        <Field label="Nome do grafo">
          <TextInput
            value={doc.name}
            onChange={(event) => dispatch({ type: "rename", name: event.target.value })}
          />
        </Field>
        <p className="text-xs text-muted-foreground">
          Clique num bloco ou numa seta para editar. Arraste de um ponto a outro para ligar.
        </p>
      </Section>
    );
  }

  return (
    <aside
      aria-label="Inspetor"
      className="flex w-80 shrink-0 flex-col gap-5 overflow-y-auto border-l bg-card p-4"
    >
      {body}
    </aside>
  );
}

function setNode(dispatch: Dispatch, id: string) {
  return (path: FieldPath, value: unknown) => dispatch({ type: "setNodeField", id, path, value });
}

function NodeInspector({
  doc,
  node,
  issues,
  dispatch,
}: {
  doc: GraphDoc;
  node: GraphNode;
  issues: LocatedIssue[];
  dispatch: Dispatch;
}) {
  const set = setNode(dispatch, node.id);
  const titles = { agent: "Agente", tool: "Ferramenta", trigger: "Gatilho" } as const;
  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-lg font-extrabold">
        {node.type === "tool" && node.tool.kind === "obsidian" ? "Memória" : titles[node.type]}
      </h2>
      <IssueList issues={issues} />
      {node.type === "agent" && <AgentFields doc={doc} node={node} set={set} />}
      {node.type === "tool" && <ToolFields node={node} doc={doc} dispatch={dispatch} set={set} />}
      {node.type === "trigger" && <TriggerFields doc={doc} node={node} set={set} />}
    </div>
  );
}

type Setter = (path: FieldPath, value: unknown) => void;

function AgentFields({ doc, node, set }: { doc: GraphDoc; node: AgentNode; set: Setter }) {
  const runtime = node.runtime;
  const peers = peersOf(doc, node.name);
  const tools = toolsOf(doc, node.name);
  return (
    <>
      <Section title="Identidade">
        <Field label="Nome" hint="É como os outros agentes o chamam.">
          <TextInput value={node.name} onChange={(e) => set(["name"], e.target.value)} />
        </Field>
      </Section>

      <AgentAccess node={node} set={set} />

      <Section title="Instruções">
        <Field label="Papel">
          <TextInput value={node.role} onChange={(e) => set(["role"], e.target.value)} />
        </Field>
        <Field label="Contexto" hint="Instruções que o agente recebe ao começar.">
          <TextArea
            className="min-h-32"
            value={node.instructions}
            onChange={(e) => set(["instructions"], e.target.value)}
          />
        </Field>
      </Section>

      <Section title="Runtime">
        <Field label="Tipo">
          <Select
            value={runtime.kind}
            onChange={(e) =>
              set(
                ["runtime"],
                e.target.value === "api" ? defaultApiRuntime() : defaultTerminalRuntime(),
              )
            }
          >
            <option value="api">API</option>
            <option value="terminal">Terminal</option>
          </Select>
        </Field>
        {runtime.kind === "api" ? (
          <>
            <Field label="Fornecedor">
              <Select
                value={runtime.provider}
                onChange={(e) => set(["runtime", "provider"], e.target.value)}
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="openai-compatible">Compatível com OpenAI</option>
                {!["openai", "anthropic", "openai-compatible"].includes(runtime.provider) && (
                  <option value={runtime.provider}>{runtime.provider} (indisponível)</option>
                )}
              </Select>
            </Field>
            <Field label="Modelo">
              <TextInput
                value={runtime.model}
                onChange={(e) => set(["runtime", "model"], e.target.value)}
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="CLI">
              <Select value={runtime.cli} onChange={(e) => set(["runtime", "cli"], e.target.value)}>
                {CLIS.map((cli) => (
                  <option key={cli} value={cli}>
                    {cli}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Runner (ID opcional)">
              <TextInput
                value={runtime.runnerId ?? ""}
                onChange={(event) => set(["runtime", "runnerId"], event.target.value || undefined)}
                placeholder="Automático: menor carga"
              />
            </Field>
            {runtime.cli === "custom" && (
              <Field label="Comando">
                <TextInput
                  value={runtime.command ?? ""}
                  onChange={(e) => set(["runtime", "command"], e.target.value || undefined)}
                />
              </Field>
            )}
            <Field label="Modelo" hint="Vazio: usa o modelo padrão da CLI.">
              <TextInput
                value={runtime.model ?? ""}
                placeholder="Padrão da CLI"
                onChange={(event) => set(["runtime", "model"], event.target.value || undefined)}
              />
            </Field>
            <Field label="Pasta de trabalho" hint="Caminho absoluto.">
              <TextInput
                value={runtime.cwd}
                onChange={(e) => set(["runtime", "cwd"], e.target.value)}
              />
            </Field>
            <ListField
              label="Argumentos"
              hint="Um por linha."
              value={runtime.args}
              onChange={(value) => set(["runtime", "args"], value)}
            />
            <Field label="Modo">
              <Select
                value={runtime.mode ?? "pty"}
                onChange={(e) =>
                  set(["runtime", "mode"], e.target.value === "pty" ? undefined : e.target.value)
                }
              >
                <option value="pty">Terminal ao vivo (pty)</option>
                <option value="stream-json">Sessão estruturada (stream-json)</option>
              </Select>
            </Field>
          </>
        )}
      </Section>

      <Section title="Execução">
        <Field label="Esforço">
          <Select value={node.effort} onChange={(e) => set(["effort"], e.target.value)}>
            {EFFORTS.map((effort) => (
              <option key={effort} value={effort}>
                {effort}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Orçamento (US$)" hint="Vazio: sem limite próprio.">
          <TextInput
            type="number"
            min="0"
            step="0.01"
            value={node.budgetUsd ?? ""}
            onChange={(e) => set(["budgetUsd"], parseOptionalNumber(e.target.value))}
          />
        </Field>
        <Field label="Tempo ocioso (s)" hint="Vazio: usa o padrão do servidor.">
          <TextInput
            type="number"
            min="0"
            step="1"
            value={node.idleTimeoutSec ?? ""}
            onChange={(e) => set(["idleTimeoutSec"], parseOptionalNumber(e.target.value))}
          />
        </Field>
      </Section>

      <Section title="Ligações">
        <Connections label="Pode falar com" names={peers.canMessage.map((p) => p.name)} />
        <Connections label="Ferramentas" names={tools.map((t) => t.name)} />
      </Section>
    </>
  );
}

function Connections({ label, names }: { label: string; names: string[] }) {
  return (
    <div className="text-sm">
      <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <p className={cn(names.length === 0 && "text-muted-foreground")}>
        {names.length > 0 ? names.join(", ") : "Nenhuma"}
      </p>
    </div>
  );
}

const TOOL_KINDS = [
  ["obsidian", "Obsidian"],
  ["http", "HTTP"],
  ["mcp-stdio", "MCP (comando)"],
  ["mcp-http", "MCP (HTTP)"],
] as const;

function toolKey(tool: ToolNode["tool"]) {
  return tool.kind === "mcp" ? `mcp-${tool.transport}` : tool.kind;
}

function defaultTool(key: string): ToolNode["tool"] {
  switch (key) {
    case "http":
      return { kind: "http", method: "GET", url: "", headers: {} };
    case "mcp-stdio":
      return { kind: "mcp", transport: "stdio", command: "", args: [], allowedTools: [] };
    case "mcp-http":
      return { kind: "mcp", transport: "http", url: "", allowedTools: [] };
    default:
      return { kind: "obsidian", vaultPath: "", readOnly: true };
  }
}

function ToolFields({
  node,
  doc,
  dispatch,
  set,
}: {
  node: ToolNode;
  doc: GraphDoc;
  dispatch: Dispatch;
  set: Setter;
}) {
  const tool = node.tool;
  return (
    <Section title="Configuração">
      <Field label="Nome">
        <TextInput value={node.name} onChange={(e) => set(["name"], e.target.value)} />
      </Field>
      <Field label="Tipo">
        <Select value={toolKey(tool)} onChange={(e) => set(["tool"], defaultTool(e.target.value))}>
          {TOOL_KINDS.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      {tool.kind === "obsidian" && (
        <MemoryFields node={node} doc={doc} dispatch={dispatch} set={set} />
      )}
      {tool.kind === "http" && (
        <>
          <Field label="Método">
            <Select value={tool.method} onChange={(e) => set(["tool", "method"], e.target.value)}>
              {["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => (
                <option key={method}>{method}</option>
              ))}
            </Select>
          </Field>
          <Field label="URL">
            <TextInput value={tool.url} onChange={(e) => set(["tool", "url"], e.target.value)} />
          </Field>
        </>
      )}
      {tool.kind === "mcp" && (
        <>
          {tool.transport === "stdio" ? (
            <>
              <Field label="Comando">
                <TextInput
                  value={tool.command}
                  onChange={(e) => set(["tool", "command"], e.target.value)}
                />
              </Field>
              <ListField
                label="Argumentos"
                hint="Um por linha."
                value={tool.args}
                onChange={(value) => set(["tool", "args"], value)}
              />
            </>
          ) : (
            <Field label="URL">
              <TextInput value={tool.url} onChange={(e) => set(["tool", "url"], e.target.value)} />
            </Field>
          )}
          <ListField
            label="Ferramentas permitidas"
            hint="Uma por linha."
            value={tool.allowedTools}
            onChange={(value) => set(["tool", "allowedTools"], value)}
          />
        </>
      )}
    </Section>
  );
}

function TriggerFields({ doc, node, set }: { doc: GraphDoc; node: TriggerNode; set: Setter }) {
  const agents = doc.nodes.filter((n): n is AgentNode => n.type === "agent");
  const hasApi = useHasApi();
  return (
    <>
      <Section title="Configuração">
        <Field label="Tipo">
          <Select
            value={node.kind}
            onChange={(e) => {
              set(["kind"], e.target.value);
              if (e.target.value !== "schedule") {
                set(["cron"], undefined);
                set(["timezone"], undefined);
              }
            }}
          >
            <option value="manual">Manual</option>
            <option value="webhook">Webhook</option>
            <option value="schedule">Agenda</option>
          </Select>
        </Field>
        {node.kind === "schedule" && (
          <>
            <Field
              label="Expressão cron"
              hint="Cinco campos: minuto hora dia mês dia-da-semana. Ex.: 0 9 * * 1-5"
            >
              <TextInput
                value={node.cron ?? ""}
                onChange={(e) => set(["cron"], e.target.value || undefined)}
              />
            </Field>
            <Field
              label="Fuso horário"
              hint="Vazio: o fuso do servidor. Ex.: America/Sao_Paulo, UTC"
            >
              <TextInput
                value={node.timezone ?? ""}
                placeholder="fuso do servidor"
                onChange={(e) => set(["timezone"], e.target.value.trim() || undefined)}
              />
            </Field>
            <TimezoneHint timezone={node.timezone} />
            <SchedulePreview cron={node.cron ?? ""} timezone={node.timezone} />
          </>
        )}
        <Field label="Inicia o agente">
          <Select value={node.target} onChange={(e) => set(["target"], e.target.value)}>
            <option value="">Nenhum</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </Select>
        </Field>
      </Section>
      {hasApi && node.kind !== "manual" && (
        <Section title={node.kind === "webhook" ? "Webhook" : "Agendamento"}>
          <ExternalTriggerPanel graphId={doc.id} node={node} />
        </Section>
      )}
    </>
  );
}

function LinkInspector({
  link,
  issues,
  dispatch,
}: {
  link: Link;
  issues: LocatedIssue[];
  dispatch: Dispatch;
}) {
  const set = (path: FieldPath, value: unknown) =>
    dispatch({ type: "setLinkField", id: link.id, path, value });
  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-lg font-extrabold">
        {link.kind === "talk" ? "Conversa" : "Uso de ferramenta"}
      </h2>
      <IssueList issues={issues} />
      {link.kind === "talk" && (
        <>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={link.bidirectional}
              onChange={(e) => set(["bidirectional"], e.target.checked)}
              className="size-4 accent-accent"
            />
            Seta dupla (os dois podem começar a conversa)
          </label>
          <Field label="Limite de mensagens" hint="Vazio: usa o limite do servidor.">
            <TextInput
              type="number"
              min="1"
              step="1"
              value={link.maxMessages ?? ""}
              onChange={(e) => set(["maxMessages"], parseOptionalNumber(e.target.value))}
            />
          </Field>
        </>
      )}
      {link.kind === "uses" && (
        <p className="text-sm text-muted-foreground">
          O agente de origem pode chamar a ferramenta de destino.
        </p>
      )}
    </div>
  );
}
