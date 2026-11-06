import { Inject, Injectable } from "@nestjs/common";
import { ClientRateLimit } from "./client-rate-limit.js";
import { TerminalInputRefusedError } from "./terminal-errors.js";
import { requireTerminalAgent } from "./terminal-input.js";
import { TerminalSessions } from "./terminal-sessions.js";
import { TERMINAL_RESIZE_LIMITS, isAllowedTerminalSize } from "./terminal-size.js";

/** What `terminal.resize` carries once the message is well formed. */
export interface TerminalResizeRequest {
  runId: string;
  agent: string;
  /** What the viewer can show of the terminal, in character cells. */
  cols: number;
  rows: number;
}

/**
 * Lets a viewer say how big its terminal screen is. The checks are the ones of `terminal.input`
 * (the run is running and belongs to whoever asks, the agent is one of its terminal agents) plus a
 * bounded size and a rate per connection. The terminal itself takes the smallest size among its
 * viewers (see {@link TerminalSessions.reportSize}), so a request is a report, not an order.
 */
@Injectable()
export class TerminalResize {
  private readonly rate = new ClientRateLimit(TERMINAL_RESIZE_LIMITS.maxPerSecond);

  constructor(@Inject(TerminalSessions) private readonly terminals: TerminalSessions) {}

  /**
   * @param client whoever is asking (one connection): the rate is counted per client.
   * @throws DomainError with the reason, in a `code` the client can act on.
   */
  request(client: object, request: TerminalResizeRequest): void {
    if (!this.rate.take(client)) {
      throw new TerminalInputRefusedError(
        "resize_rate_limited",
        "Muitos redimensionamentos do terminal em pouco tempo; espere um instante.",
        "unavailable",
      );
    }
    if (!isAllowedTerminalSize(request.cols, request.rows)) {
      const { minCols, maxCols, minRows, maxRows } = TERMINAL_RESIZE_LIMITS;
      throw new TerminalInputRefusedError(
        "invalid_size",
        `O terminal aceita de ${minCols} a ${maxCols} colunas e de ${minRows} a ${maxRows} linhas.`,
        "invalid",
      );
    }
    const agent = requireTerminalAgent(this.terminals, request.runId, request.agent);
    this.terminals.reportSize(client, request.runId, agent.name, request.cols, request.rows);
  }
}
