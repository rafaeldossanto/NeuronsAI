import { Inject, Injectable, Logger } from "@nestjs/common";
import type { HooksConfig } from "../shared/config/app-config.js";
import { SecretsService } from "../secrets/secrets.service.js";
import { DomainError } from "../shared/errors/domain-error.js";
import { RateLimiter } from "./rate-limiter.js";
import { TriggerLauncher } from "./trigger-launcher.js";
import {
  TRIGGER_STATE_REPOSITORY,
  type TriggerStateRecord,
  type TriggerStateRepository,
} from "./trigger-state.js";
import { webhookSecretName } from "./triggers.service.js";
import { SIGNATURE_WINDOW_SEC, verifySignature } from "./webhook-signature.js";
import { resourceScope } from "../accounts/resource-scope.js";

export const HOOKS_CONFIG = Symbol("HOOKS_CONFIG");

/** What the webhook route does with a request. Everything but `accepted` is answered without detail. */
export type WebhookResult =
  | { kind: "accepted"; runId: string }
  | { kind: "unauthorized" }
  | { kind: "rate_limited"; retryAfterSec: number };

export interface WebhookRequest {
  hookId: string;
  timestampHeader: string | undefined;
  signatureHeader: string | undefined;
  /** The body exactly as received: the signature covers these bytes. */
  body: Buffer;
}

/** How long a signature is remembered: a request stamped in the future stays valid for the window after that. */
const PURGE_EVERY_MS = 60_000;
const REPLAY_MEMORY_MS = (2 * SIGNATURE_WINDOW_SEC + 60) * 1000;

/** The shared bucket of every id nobody has: scanning for ids is throttled as a whole. */
const UNKNOWN_HOOK = "?";

const EMPTY_BODY_INPUT = "(requisição sem corpo)";

/**
 * Receives a webhook call: throttles, finds the trigger by its opaque id, checks the HMAC
 * signature, refuses a replay and starts a run of the latest published version with the body as
 * the first message to the trigger's target agent.
 *
 * Whatever is wrong with the credentials (unknown or off trigger, no secret, bad headers, wrong,
 * expired or repeated signature) gives the same {@link WebhookResult} `unauthorized`; the reason
 * only goes to the log. Neither the secret, the signature nor the body is ever logged.
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private readonly limiter: RateLimiter;
  private lastPurgeAt = 0;

  constructor(
    @Inject(TRIGGER_STATE_REPOSITORY) private readonly states: TriggerStateRepository,
    @Inject(SecretsService) private readonly secrets: SecretsService,
    @Inject(TriggerLauncher) private readonly launcher: TriggerLauncher,
    @Inject(HOOKS_CONFIG) hooks: Pick<HooksConfig, "ratePerMinute">,
  ) {
    this.limiter = new RateLimiter(hooks.ratePerMinute);
  }

  /** @throws DomainError for a problem the authenticated caller may know about (no published version, say). */
  async handle(request: WebhookRequest): Promise<WebhookResult> {
    const state = await this.states.findByHookId(request.hookId);
    // Unknown ids share one bucket so that scanning cannot create buckets without bound.
    if (!this.limiter.tryTake(state ? request.hookId : UNKNOWN_HOOK)) {
      return { kind: "rate_limited", retryAfterSec: this.limiter.retryAfterSec() };
    }
    if (!state?.enabled || !state.secretSetAt) {
      return this.refuse(request.hookId, state ? "disabled_or_no_secret" : "unknown_hook");
    }

    return resourceScope.run({ organizationId: state.organizationId ?? null }, () =>
      this.handleScoped(request, state),
    );
  }

  private async handleScoped(
    request: WebhookRequest,
    state: TriggerStateRecord,
  ): Promise<WebhookResult> {
    const secret = await this.secretOf(state);
    if (secret === undefined) return this.refuse(request.hookId, "secret_unavailable");

    const now = new Date();
    const check = verifySignature({
      secret,
      timestampHeader: request.timestampHeader,
      signatureHeader: request.signatureHeader,
      body: request.body,
      now,
    });
    if (!check.ok) return this.refuse(request.hookId, check.reason);

    if (!(await this.states.recordDelivery(request.hookId, check.signature, now))) {
      return this.refuse(request.hookId, "replay");
    }
    // At most once a minute: the purge scans for old rows, not worth doing per accepted request.
    if (now.getTime() - this.lastPurgeAt >= PURGE_EVERY_MS) {
      this.lastPurgeAt = now.getTime();
      void this.states
        .purgeDeliveries(new Date(now.getTime() - REPLAY_MEMORY_MS))
        .catch(() => undefined);
    }

    return this.start(state, request.body, now);
  }

  private async start(state: TriggerStateRecord, body: Buffer, now: Date): Promise<WebhookResult> {
    const input = body.length > 0 ? body.toString("utf8") : EMPTY_BODY_INPUT;
    try {
      const run = await this.launcher.launch(state.graphId, state.triggerId, "webhook", input);
      await this.states.update(state.graphId, state.triggerId, {
        lastFiredAt: now,
        lastOutcome: "started",
        lastNote: null,
        lastRunId: run.id,
      });
      // The size says enough: the body can hold anything the sender put in it.
      this.logger.log(
        `Webhook ${shortId(state.hookId)} aceito: execução ${run.id} (${body.length} bytes).`,
      );
      return { kind: "accepted", runId: run.id };
    } catch (error) {
      await this.states
        .update(state.graphId, state.triggerId, {
          lastFiredAt: now,
          lastOutcome: "failed",
          lastNote:
            error instanceof DomainError ? error.message : "Erro inesperado ao iniciar a execução.",
        })
        .catch(() => undefined);
      throw error;
    }
  }

  private async secretOf(state: TriggerStateRecord): Promise<string | undefined> {
    try {
      return await this.secrets.get(webhookSecretName(state.hookId));
    } catch (error) {
      // No master key, or the secret is gone or cannot be read: the caller learns nothing of it.
      this.logger.warn(
        `Webhook ${shortId(state.hookId)}: segredo indisponível (${error instanceof DomainError ? error.code : "erro"}).`,
      );
      return undefined;
    }
  }

  private refuse(hookId: string, reason: string): WebhookResult {
    this.logger.warn(`Webhook ${shortId(hookId)} recusado: ${reason}.`);
    return { kind: "unauthorized" };
  }
}

/** Enough of the opaque id to tell triggers apart in the log, not enough to use the URL. */
const shortId = (hookId: string) => `${hookId.slice(0, 4)}…`;
