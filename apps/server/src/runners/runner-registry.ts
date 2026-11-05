import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import {
  CLOSE_NOT_ACCEPTED,
  CLOSE_PROTOCOL,
  CLOSE_UNAUTHORIZED,
  PROTOCOL_VERSION,
  type RejectFrame,
  type ServerChannel,
} from "@neurons/runner-protocol";
import type { AppConfig } from "../shared/config/app-config.js";
import { APP_CONFIG } from "../shared/config/tokens.js";
import { Signal } from "../shared/signal.js";
import type { RunnerEndpoint, RunnerPool } from "./remote-agent-runtime.js";
import { RunnerLink, type LinkLogger } from "./runner-link.js";
import type { RunnerIdentity } from "./runner-tokens.service.js";
import { NoRunnerAvailableError } from "./runners.errors.js";
import { resourceScope } from "../accounts/resource-scope.js";

/** How long a connection may take to send its `register`. */
const REGISTER_TIMEOUT_MS = 10_000;

const CLOSE_FOR: Record<RejectFrame["code"], number> = {
  unauthorized: CLOSE_UNAUTHORIZED,
  not_accepted: CLOSE_NOT_ACCEPTED,
  unsupported_protocol: CLOSE_PROTOCOL,
  invalid_frame: CLOSE_PROTOCOL,
};

/** Tells the runner why it was refused and ends the connection. */
export function rejectChannel(
  channel: ServerChannel,
  code: RejectFrame["code"],
  message: string,
): void {
  channel.send({ v: PROTOCOL_VERSION, type: "reject", code, message });
  channel.close(CLOSE_FOR[code], message);
}

/** The runners known to this server and the choice of which one hosts a new agent. */
@Injectable()
export class RunnerRegistry implements RunnerPool, OnApplicationShutdown {
  /** A runner (re)connected. */
  readonly linkConnected = new Signal<RunnerLink>();

  private readonly logger = new Logger("Runners");
  private readonly links = new Map<string, RunnerLink>();
  private readonly linkLogger: LinkLogger = {
    log: (message) => this.logger.log(message),
    warn: (message) => this.logger.warn(message),
  };

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /**
   * Takes a connection that already proved who it is. The first frame it sends must be `register`;
   * from then on the runner's link owns the channel.
   */
  accept(identity: RunnerIdentity, channel: ServerChannel): void {
    const timeout = setTimeout(
      () => rejectChannel(channel, "invalid_frame", "O runner não enviou o register a tempo."),
      REGISTER_TIMEOUT_MS,
    );
    timeout.unref();
    const stop = () => {
      clearTimeout(timeout);
      stopFrames();
      stopInvalid();
    };
    const stopFrames = channel.onFrame((frame) => {
      stop();
      if (frame.type !== "register") {
        return rejectChannel(channel, "invalid_frame", "O primeiro frame deve ser register.");
      }
      const link = this.linkFor(identity);
      link.attach(channel, frame);
      this.logger.log(
        `Runner "${identity.name}" conectado (${frame.agents.length} agente(s) ainda vivos).`,
      );
      this.linkConnected.emit(link);
    });
    const stopInvalid = channel.onInvalid((failure) => {
      stop();
      rejectChannel(
        channel,
        failure.code === "unsupported_version" ? "unsupported_protocol" : "invalid_frame",
        failure.message,
      );
    });
    channel.onClose(() => clearTimeout(timeout));
  }

  /** The runner with the fewest agents among the connected ones; waits for one when none is. */
  acquire(): Promise<RunnerEndpoint> {
    const organizationId = resourceScope.current().organizationId;
    const ready = this.pick(organizationId);
    if (ready) return Promise.resolve(ready);

    const waitMs = this.config.runners.waitMs;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        stop();
        reject(new NoRunnerAvailableError(waitMs));
      }, waitMs);
      const stop = this.linkConnected.subscribe((link) => {
        if ((link.identity.organizationId ?? null) !== organizationId) return;
        clearTimeout(timer);
        stop();
        resolve(link);
      });
    });
  }

  /** The link of a runner that connected at least once since the server started. */
  find(runnerId: string): RunnerLink | undefined {
    return this.links.get(runnerId);
  }

  /** The connected runners (for diagnostics and tests). */
  connected(): RunnerLink[] {
    return [...this.links.values()].filter((link) => link.connected);
  }

  onApplicationShutdown(): void {
    for (const link of this.links.values()) link.dispose();
    this.links.clear();
  }

  private pick(organizationId: string | null): RunnerLink | undefined {
    return this.connected()
      .filter((link) => (link.identity.organizationId ?? null) === organizationId)
      .sort((a, b) => a.load - b.load)[0];
  }

  private linkFor(identity: RunnerIdentity): RunnerLink {
    let link = this.links.get(identity.id);
    if (!link) {
      link = new RunnerLink(identity, this.config.runners, this.linkLogger);
      this.links.set(identity.id, link);
    }
    return link;
  }
}
