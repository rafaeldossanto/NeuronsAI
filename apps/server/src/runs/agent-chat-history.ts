import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { resourceScope } from "../accounts/resource-scope.js";
import { DatabaseService } from "../database/database.service.js";
import { graphVersions, graphs, messages, runEvents, runs } from "../database/schema/index.js";
import { HUMAN } from "../hub/addresses.js";
import type { AgentChatQuery, AgentChatTurn } from "./agent-chat.contract.js";

interface ChatMessage {
  id: string;
  from: string;
  to: string;
  body: string;
  imageName: string | null;
  replyTo: string | null;
}

interface ChatEvent {
  type: string;
  agent: string | null;
  payload: unknown;
}

@Injectable()
export class AgentChatHistory {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async list(graphId: string, agentId: string, { limit, offset }: AgentChatQuery) {
    const db = this.database.db;
    const page = await db
      .select({ runId: runs.id, graphVersionId: runs.graphVersionId, status: runs.status })
      .from(runs)
      .innerJoin(graphVersions, eq(graphVersions.id, runs.graphVersionId))
      .innerJoin(graphs, eq(graphs.id, graphVersions.graphId))
      .where(
        and(
          eq(graphs.id, graphId),
          resourceScope.matches(graphs.organizationId),
          eq(runs.chatAgentId, agentId),
        ),
      )
      .orderBy(desc(runs.startedAt), desc(runs.id))
      .limit(limit + 1)
      .offset(offset);

    const turns = page.slice(0, limit);
    if (turns.length === 0) return { items: [], hasMore: false };

    const runIds = turns.map(({ runId }) => runId);
    const [chatMessages, chatEvents] = await Promise.all([
      db
        .select({
          runId: messages.runId,
          id: messages.id,
          from: messages.fromAgent,
          to: messages.toAgent,
          body: messages.body,
          imageName: sql<string | null>`${messages.chat} -> 'image' ->> 'name'`,
          replyTo: messages.replyTo,
        })
        .from(messages)
        .where(
          and(
            inArray(messages.runId, runIds),
            or(
              and(eq(messages.fromAgent, HUMAN), isNotNull(messages.chat)),
              eq(messages.toAgent, HUMAN),
            ),
          ),
        )
        .orderBy(asc(messages.seq)),
      db
        .select({
          runId: runEvents.runId,
          type: runEvents.type,
          agent: runEvents.agent,
          payload: runEvents.payload,
        })
        .from(runEvents)
        .where(
          and(
            inArray(runEvents.runId, runIds),
            inArray(runEvents.type, ["RunStarted", "RunFinished", "AgentFailed"]),
          ),
        )
        .orderBy(asc(runEvents.seq)),
    ]);
    const messagesByRun = groupByRun(chatMessages);
    const eventsByRun = groupByRun(chatEvents);
    const items = turns.map((turn) =>
      toChatTurn(turn, messagesByRun.get(turn.runId) ?? [], eventsByRun.get(turn.runId) ?? []),
    );
    return { items, hasMore: page.length > limit };
  }
}

function groupByRun<T extends { runId: string }>(rows: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(row.runId);
    if (group) group.push(row);
    else groups.set(row.runId, [row]);
  }
  return groups;
}

function toChatTurn(
  turn: Pick<AgentChatTurn, "runId" | "graphVersionId" | "status">,
  messagesInRun: ChatMessage[],
  events: ChatEvent[],
): AgentChatTurn {
  const sent = messagesInRun.find((message) => message.from === HUMAN);
  const replies = sent
    ? messagesInRun
        .filter(
          (message) =>
            message.from === sent.to && message.to === HUMAN && message.replyTo === sent.id,
        )
        .map(({ id, body }) => ({ id, text: body }))
    : [];
  const started = events.find(({ type }) => type === "RunStarted");
  const finish = events.find(({ type }) => type === "RunFinished");
  const selectedAgentFailure = events.find(
    ({ type, agent }) => type === "AgentFailed" && agent === sent?.to,
  );
  const result = finish?.agent === sent?.to ? textField(finish?.payload, "result") : null;
  if (result && replies.length === 0) replies.push({ id: turn.runId, text: result });

  return {
    ...turn,
    input: sent?.body ?? textField(started?.payload, "input") ?? "",
    imageName: sent?.imageName ?? null,
    replies,
    error:
      textField(finish?.payload, "error") ??
      textField(finish?.payload, "message") ??
      textField(selectedAgentFailure?.payload, "reason") ??
      turnError(turn.status, replies.length),
  };
}

function textField(payload: unknown, field: string): string | null {
  if (payload === null || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>)[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function turnError(status: AgentChatTurn["status"], replies: number): string | null {
  if (status === "failed") return "A execução não pôde ser concluída.";
  if (status === "cancelled") return "A execução foi interrompida.";
  if (status === "succeeded" && replies === 0)
    return "O agente encerrou a execução sem responder ao chat.";
  return null;
}
