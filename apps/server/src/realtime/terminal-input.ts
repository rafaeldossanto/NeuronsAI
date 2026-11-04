import { Inject, Injectable } from "@nestjs/common";
import { DomainError } from "../shared/errors/domain-error.js";
import type { TerminalInputLimits } from "../shared/config/terminal-config.js";
import { TERMINAL_INPUT_LIMITS } from "../shared/config/tokens.js";
import { TerminalInputRefusedError, TerminalUnavailableError } from "./terminal-errors.js";
import { TerminalSessions } from "./terminal-sessions.js";

/** What `terminal.input` carries once validated. */
export interface TerminalInputRequest {
  runId: string;
  agent: string;
  /** Exactly what the person typed (keys, a paste, control sequences). Never stored nor logged. */
  data: string;
}

interface Bucket {
  tokens: number;
  at: number;
}

/**
 * Lets a person type into an agent's terminal: checks that the agent is one of the run, that it has
 * a terminal, that the run is running, and that the message is not too big nor too frequent. What
 * was typed goes straight to the terminal and nowhere else: it may be a password, so it is not
 * logged, not put in an event and not repeated in an error.
 */
@Injectable()
export class TerminalInput {
  private readonly buckets = new WeakMap<object, Bucket>();

  constructor(
    @Inject(TerminalSessions) private readonly terminals: TerminalSessions,
    @Inject(TERMINAL_INPUT_LIMITS) private readonly limits: TerminalInputLimits,
  ) {}

  /**
   * @param client whoever is typing (one connection): the rate is counted per client.
   * @throws DomainError with the reason, in a `code` the client can act on.
   */
  write(client: object, request: TerminalInputRequest): void {
    this.takeToken(client);
    if (request.data.length > this.limits.maxChars) {
      throw new TerminalInputRefusedError(
        "input_too_large",
        `Cada mensagem de teclado aceita até ${this.limits.maxChars} caracteres; esta tinha mais.`,
        "invalid",
      );
    }

    const graph = this.terminals.activeGraph(request.runId);
    if (!graph) {
      throw new TerminalInputRefusedError(
        "run_not_running",
        `A execução "${request.runId}" não está em andamento.`,
        "conflict",
      );
    }
    const agent = graph.nodes.find((node) => node.type === "agent" && node.name === request.agent);
    if (agent?.type !== "agent") {
      throw new TerminalInputRefusedError(
        "agent_not_in_run",
        `"${request.agent}" não é um agente desta execução.`,
        "not_found",
      );
    }
    if (agent.runtime.kind !== "terminal" || agent.runtime.mode !== "pty") {
      throw new TerminalInputRefusedError(
        "not_a_terminal",
        `O agente "${agent.name}" não roda num terminal que se possa digitar.`,
        "invalid",
      );
    }

    try {
      this.terminals.writeInput(request.runId, agent.name, request.data);
    } catch (error) {
      if (error instanceof DomainError) throw error;
      // A runtime failing to write: say the terminal is unreachable, without its own message.
      throw new TerminalUnavailableError(agent.name);
    }
  }

  /** A bucket of `maxPerSecond` tokens that refills at that rate: bursts pass, a flood does not. */
  private takeToken(client: object): void {
    const capacity = this.limits.maxPerSecond;
    const now = Date.now();
    const bucket = this.buckets.get(client) ?? { tokens: capacity, at: now };
    bucket.tokens = Math.min(capacity, bucket.tokens + ((now - bucket.at) / 1000) * capacity);
    bucket.at = now;
    this.buckets.set(client, bucket);
    if (bucket.tokens < 1) {
      throw new TerminalInputRefusedError(
        "rate_limited",
        "Muitas mensagens de teclado em pouco tempo; espere um instante.",
        "unavailable",
      );
    }
    bucket.tokens -= 1;
  }
}
