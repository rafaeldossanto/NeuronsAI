import { Inject, Injectable, Logger, Optional, type OnApplicationShutdown } from "@nestjs/common";
import {
  CLOSE_NOT_ACCEPTED,
  CLOSE_PROTOCOL,
  CLOSE_UNAUTHORIZED,
  PROTOCOL_VERSION,
  type RejectFrame,
  type ServerChannel,
} from "@neurons/runner-protocol";
import { z } from "zod";
import type { AppConfig } from "../shared/config/app-config.js";
import { APP_CONFIG } from "../shared/config/tokens.js";
import { Signal } from "../shared/signal.js";
import type { RunnerEndpoint, RunnerPool } from "./remote-agent-runtime.js";
import { RunnerLink, type LinkLogger } from "./runner-link.js";
import type { RunnerIdentity } from "./runner-tokens.service.js";
import { RUNNER_REPOSITORY, type RunnerRepository } from "./runner-repository.js";
import { NoRunnerAvailableError, RunnerNotAllowedError } from "./runners.errors.js";
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

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    /** Tells who owns a runner that is not connected; without it only connected runners are known. */
    @Optional() @Inject(RUNNER_REPOSITORY) private readonly repository?: RunnerRepository,
  ) {}

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

  /**
   * The runner that hosts a new agent, always inside the run's organization:
   * - with `runnerId`: that runner, if it belongs to the organization or to whoever started the run
   *   (someone else's personal runner is refused at once);
   * - otherwise, the personal runners of whoever started the run (the least busy connected one),
   *   then the organization's; a run nobody started (a trigger) never uses a personal runner.
   * Waits for the first runner that fits to connect when none is.
   * @throws RunnerNotAllowedError, NoRunnerAvailableError
   */
  async acquire(runnerId?: string): Promise<RunnerEndpoint> {
    const { organizationId, userId } = resourceScope.current();
    const starter = userId ?? null;
    if (runnerId) await this.requireUsable(runnerId, organizationId, starter);
    const ready = this.pick(organizationId, starter, runnerId);
    if (ready) return ready;

    const waitMs = this.config.runners.waitMs;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        stop();
        reject(new NoRunnerAvailableError(waitMs));
      }, waitMs);
      const stop = this.linkConnected.subscribe((link) => {
        if (!this.fits(link, organizationId, starter, runnerId)) return;
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

  /** Cuts the connection of a runner whose token was revoked or replaced; its runner is told why. */
  disconnect(runnerId: string): void {
    this.links.get(runnerId)?.revoke("Token revogado.");
  }

  /** The runner a name or id points at may be used by this run, whether or not it is connected. */
  private async requireUsable(
    runnerId: string,
    organizationId: string | null,
    starter: string | null,
  ): Promise<void> {
    const connectedBefore = this.links.get(runnerId)?.identity;
    // The id comes from the graph and may not be one the database knows (the embedded runner has none).
    const stored =
      !connectedBefore && z.uuid().safeParse(runnerId).success
        ? await this.repository?.findById(runnerId)
        : undefined;
    const known = connectedBefore ?? stored;
    if (!known || (known.organizationId ?? null) !== organizationId) return; // the wait decides
    if (!isUsableBy(known.ownerUserId ?? null, starter)) throw new RunnerNotAllowedError();
  }

  /** Whether a runner may host an agent of a run of `organizationId` started by `starter`. */
  private fits(
    link: RunnerLink,
    organizationId: string | null,
    starter: string | null,
    runnerId?: string,
  ): boolean {
    const { identity } = link;
    if ((identity.organizationId ?? null) !== organizationId) return false;
    if (runnerId)
      return identity.id === runnerId && isUsableBy(identity.ownerUserId ?? null, starter);
    const owner = identity.ownerUserId ?? null;
    return owner === null || owner === starter;
  }

  private pick(
    organizationId: string | null,
    starter: string | null,
    runnerId?: string,
  ): RunnerLink | undefined {
    const usable = this.connected().filter((link) =>
      this.fits(link, organizationId, starter, runnerId),
    );
    const leastBusy = (links: RunnerLink[]) => links.sort((a, b) => a.load - b.load)[0];
    if (runnerId || starter === null) return leastBusy(usable);
    // The starter's own computers come first; the organization's are the fallback.
    return (
      leastBusy(usable.filter((link) => link.identity.ownerUserId === starter)) ?? leastBusy(usable)
    );
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

/** A personal runner serves only its owner's runs; one of the organization serves everyone's. */
const isUsableBy = (owner: string | null, starter: string | null): boolean =>
  owner === null || owner === starter;
