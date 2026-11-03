import type { IncomingMessage } from "node:http";
import { Inject, Logger } from "@nestjs/common";
import { type OnGatewayConnection, WebSocketGateway } from "@nestjs/websockets";
import { createServerWireChannel } from "@neurons/runner-protocol";
import { WebSocket } from "ws";
import type { AppConfig } from "../shared/config/app-config.js";
import { APP_CONFIG } from "../shared/config/tokens.js";
import { RunnerRegistry, rejectChannel } from "./runner-registry.js";
import { bearerToken } from "./runner-token.js";
import { RunnerTokens, type RunnerIdentity } from "./runner-tokens.service.js";

/**
 * WebSocket endpoint at /runner, where runners connect (the connection is outbound from the
 * runner, so it works behind NAT). The token comes in the `Authorization: Bearer` header of the
 * upgrade request, never in the address, and is checked against the hashes in the database
 * before any frame is read. The `local` profile does not accept runners: its own is embedded.
 *
 * Frames are JSON text in the protocol of `@neurons/runner-protocol`.
 */
@WebSocketGateway({ path: "/runner" })
export class RunnerGateway implements OnGatewayConnection {
  private readonly logger = new Logger("RunnerGateway");

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(RunnerTokens) private readonly tokens: RunnerTokens,
    @Inject(RunnerRegistry) private readonly registry: RunnerRegistry,
  ) {}

  handleConnection(client: WebSocket, request: IncomingMessage): void {
    // What the runner sends while its token is being checked is kept and read right after.
    let early: string[] | undefined = [];
    const channel = createServerWireChannel({
      send: (text) => client.send(text),
      close: (code, reason) => client.close(code, reason),
      isOpen: () => client.readyState === WebSocket.OPEN,
    });
    client.on("message", (data, isBinary) => {
      if (isBinary) return;
      const text = Buffer.isBuffer(data)
        ? data.toString("utf8")
        : Buffer.concat(data as Buffer[]).toString("utf8");
      if (early) early.push(text);
      else channel.receive(text);
    });
    client.on("close", (code, reason) => channel.notifyClosed(code, reason.toString("utf8")));
    client.on("error", () => undefined);

    if (this.config.profile === "local") {
      return rejectChannel(
        channel,
        "not_accepted",
        "Este servidor roda no perfil local e não aceita runners externos (NEURONS_PROFILE=hybrid).",
      );
    }
    const token = bearerToken(request.headers.authorization);
    if (!token) return rejectChannel(channel, "unauthorized", "Envie o token do runner.");

    void this.tokens.authenticate(token).then(
      (identity) => {
        if (!identity)
          return rejectChannel(channel, "unauthorized", "Token desconhecido ou revogado.");
        this.registry.accept(identity, channel);
        this.watchRevocation(identity, channel);
        const queued = early ?? [];
        early = undefined;
        for (const text of queued) channel.receive(text);
        this.tokens.markSeen(identity.id).catch(() => undefined);
      },
      (error: unknown) => {
        this.logger.error(
          `Não foi possível conferir o token de um runner: ${error instanceof Error ? error.message : String(error)}`,
        );
        rejectChannel(channel, "unauthorized", "Não foi possível conferir o token agora.");
      },
    );
  }

  /** A token revoked while its runner is connected cuts the connection at the next check. */
  private watchRevocation(
    identity: RunnerIdentity,
    channel: ReturnType<typeof createServerWireChannel>,
  ): void {
    const timer = setInterval(() => {
      this.tokens.isActive(identity.id).then(
        (active) => {
          if (!active) rejectChannel(channel, "unauthorized", "Token revogado.");
        },
        () => undefined, // the database may be busy; the next check tries again
      );
    }, this.config.runners.heartbeatMs);
    timer.unref();
    channel.onClose(() => clearInterval(timer));
  }
}
