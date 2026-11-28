import { Inject, Injectable } from "@nestjs/common";
import { graphDefinitionSchema, type GraphDefinition } from "@neurons/graph-schema";
import { isDeepStrictEqual } from "node:util";
import { GRAPH_REPOSITORY, type GraphRepository } from "../graphs/graph-repository.js";
import {
  GRAPH_VERSION_REPOSITORY,
  type GraphVersionRepository,
} from "../graphs/graph-version-repository.js";
import { GraphNotFoundError } from "../graphs/graphs.errors.js";
import { DomainError } from "../shared/errors/domain-error.js";
import type { AgentChatQuery, AgentChatTurn, SendChatTurnBody } from "./agent-chat.contract.js";
import { AgentChatHistory } from "./agent-chat-history.js";
import { RunService } from "./run.service.js";

const CONTEXT_TURNS = 8;
const CONTEXT_MESSAGE_CHARS = 1500;
const CONTEXT_MAX_CHARS = 12_000;

@Injectable()
export class AgentChatsService {
  constructor(
    @Inject(GRAPH_REPOSITORY) private readonly graphs: GraphRepository,
    @Inject(GRAPH_VERSION_REPOSITORY) private readonly versions: GraphVersionRepository,
    @Inject(AgentChatHistory) private readonly history: AgentChatHistory,
    @Inject(RunService) private readonly runs: RunService,
  ) {}

  /** `onlyStartedBy`: the person reaches only the turns they started. */
  async list(graphId: string, agentId: string, query: AgentChatQuery, onlyStartedBy?: string) {
    if (!(await this.graphs.findById(graphId))) throw new GraphNotFoundError(graphId);
    return this.history.list(graphId, agentId, query, onlyStartedBy);
  }

  async send(graphId: string, agentId: string, input: SendChatTurnBody) {
    const record = await this.graphs.findById(graphId);
    if (!record) throw new GraphNotFoundError(graphId);

    const draft = graphDefinitionSchema.safeParse(record.draft);
    if (!draft.success) throw new ChatPublishRequiredError();
    const draftAgent = draft.data.nodes.find(
      (node) => node.id === agentId && node.type === "agent",
    );
    if (!draftAgent) throw new ChatAgentNotFoundError();

    const version = await this.versions.findLatest(graphId);
    const published = version && graphDefinitionSchema.safeParse(version.definition);
    if (
      !version ||
      !published?.success ||
      !isDeepStrictEqual(runSettings(draft.data), runSettings(published.data))
    ) {
      throw new ChatPublishRequiredError();
    }
    const agent = published.data.nodes.find((node) => node.id === agentId);
    if (agent?.type !== "agent") throw new ChatPublishRequiredError();
    if (input.image && agent.runtime.kind !== "api") throw new ChatImageUnsupportedError();

    return this.runs.startChat(
      { ...version, definition: published.data },
      agent,
      input.body,
      async () => {
        const { items } = await this.history.list(graphId, agentId, {
          limit: CONTEXT_TURNS + 1,
          offset: 0,
        });
        const history = transcript(items);
        return {
          ...(history && { history }),
          ...(input.image && { image: input.image }),
        };
      },
    );
  }
}

/** Moving blocks, editing annotations or renaming the project does not change a run. */
function runSettings({ nodes, links }: GraphDefinition) {
  return {
    nodes: nodes.map((node) => ({ ...node, position: undefined })),
    links,
  };
}

function transcript(turns: AgentChatTurn[]) {
  return turns
    .filter((turn) => turn.replies.length > 0)
    .reverse()
    .map((turn) => {
      const input = turn.input.slice(0, CONTEXT_MESSAGE_CHARS);
      const reply = turn.replies
        .map(({ text }) => text)
        .join("\n")
        .slice(0, CONTEXT_MESSAGE_CHARS);
      return ["Pessoa: " + input, "Agente: " + reply].join("\n");
    })
    .join("\n\n")
    .slice(-CONTEXT_MAX_CHARS);
}

class ChatAgentNotFoundError extends DomainError {
  readonly kind = "not_found";

  constructor() {
    super("chat_agent_not_found", "O bloco deste agente não está no rascunho salvo.");
  }
}

class ChatPublishRequiredError extends DomainError {
  readonly kind = "conflict";

  constructor() {
    super(
      "chat_publish_required",
      "Publique as configurações atuais do fluxo para enviar mensagens.",
    );
  }
}

class ChatImageUnsupportedError extends DomainError {
  readonly kind = "invalid";

  constructor() {
    super("chat_image_unsupported", "O envio de imagens está disponível para agentes de API.");
  }
}
