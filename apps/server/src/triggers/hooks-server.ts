import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "../shared/config/app-config.js";
import { APP_CONFIG } from "../shared/config/tokens.js";
import { toHttpError } from "../shared/http/all-exceptions.filter.js";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from "./webhook-signature.js";
import { WebhookService } from "./webhook.service.js";
import { WHATSAPP_SIGNATURE_HEADER, WhatsAppService } from "./whatsapp.service.js";

/** Only JSON and plain text are accepted, and both are kept as the raw bytes the signature covers. */
const ACCEPTED_CONTENT_TYPES = /^(?:application\/(?:[\w.-]+\+)?json|text\/plain)\s*(?:;|$)/i;

const NOT_FOUND = { code: "route_not_found", message: "Não encontrado." };

/**
 * The listener that serves **only** `/hooks/{hookId}` (`POST`, plus the `GET` Meta uses to confirm a
 * WhatsApp URL), on its own port (`NEURONS_HOOKS_PORT`).
 * It is a separate Fastify instance, not part of the API application, so the API's routes do not
 * exist here: a tunnel pointed at this port can never reach them. Off unless the port is set.
 */
@Injectable()
export class HooksServer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(HooksServer.name);
  private instance: FastifyInstance | undefined;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(WebhookService) private readonly webhooks: WebhookService,
    @Inject(WhatsAppService) private readonly whatsapp: WhatsAppService,
  ) {}

  /** The port it listens on, or undefined while it is off. (Differs from the config only for port 0.) */
  get port(): number | undefined {
    const address = this.instance?.server.address();
    return address && typeof address === "object" ? address.port : undefined;
  }

  async onApplicationBootstrap(): Promise<void> {
    const hooks = this.config.hooks;
    if (!hooks) return;
    const server = this.build(hooks.maxBodyBytes);
    try {
      await server.listen({ port: hooks.port, host: hooks.host });
    } catch (error) {
      await server.close();
      throw new Error(
        `Não foi possível abrir a porta dos gatilhos (${hooks.host}:${String(hooks.port)}): ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    this.instance = server;
    this.logger.log(
      `Porta dos gatilhos em http://${hooks.host}:${String(this.port)} (somente /hooks/{id}).`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    const server = this.instance;
    this.instance = undefined;
    await server?.close();
  }

  private build(maxBodyBytes: number): FastifyInstance {
    const server = Fastify({
      bodyLimit: maxBodyBytes,
      // A slow client cannot hold a connection open for long.
      requestTimeout: 15_000,
      keepAliveTimeout: 5_000,
      logger: false,
    });

    server.removeAllContentTypeParsers();
    server.addContentTypeParser(
      ACCEPTED_CONTENT_TYPES,
      { parseAs: "buffer" },
      (_request, body, done) => done(null, body),
    );

    server.get<{ Params: { hookId: string }; Querystring: Record<string, string | undefined> }>(
      "/hooks/:hookId",
      async (request, reply) => {
        const query = request.query;
        const result = await this.whatsapp.verify({
          hookId: request.params.hookId,
          mode: queryValue(query["hub.mode"]),
          verifyToken: queryValue(query["hub.verify_token"]),
          challenge: queryValue(query["hub.challenge"]),
        });
        switch (result.kind) {
          case "challenge":
            return reply.code(200).type("text/plain; charset=utf-8").send(result.challenge);
          case "rate_limited":
            return reply.code(429).header("retry-after", String(result.retryAfterSec)).send({
              code: "rate_limited",
              message: "Muitas chamadas. Tente de novo em instantes.",
            });
          case "forbidden":
            return reply.code(403).send({ code: "forbidden", message: "Não autorizado." });
        }
      },
    );

    server.post<{ Params: { hookId: string } }>("/hooks/:hookId", async (request, reply) => {
      // Meta signs with `X-Hub-Signature-256` and no timestamp; our own webhooks never send it.
      if (request.headers[WHATSAPP_SIGNATURE_HEADER] !== undefined) {
        const event = await this.whatsapp.receive({
          hookId: request.params.hookId,
          signatureHeader: headerOf(request.headers[WHATSAPP_SIGNATURE_HEADER]),
          body: Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0),
        });
        switch (event.kind) {
          case "received":
            return reply.code(200).send({ received: true });
          case "rate_limited":
            return reply.code(429).header("retry-after", String(event.retryAfterSec)).send({
              code: "rate_limited",
              message: "Muitas chamadas. Tente de novo em instantes.",
            });
          case "unauthorized":
            return reply.code(401).send({ code: "unauthorized", message: "Não autorizado." });
        }
      }
      const result = await this.webhooks.handle({
        hookId: request.params.hookId,
        timestampHeader: headerOf(request.headers[TIMESTAMP_HEADER]),
        signatureHeader: headerOf(request.headers[SIGNATURE_HEADER]),
        body: Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0),
      });
      switch (result.kind) {
        case "accepted":
          return reply.code(202).send({ runId: result.runId });
        case "rate_limited":
          return reply.code(429).header("retry-after", String(result.retryAfterSec)).send({
            code: "rate_limited",
            message: "Muitas chamadas. Tente de novo em instantes.",
          });
        case "unauthorized":
          return reply.code(401).send({ code: "unauthorized", message: "Não autorizado." });
      }
    });

    server.setNotFoundHandler((_request, reply) => reply.code(404).send(NOT_FOUND));
    server.setErrorHandler((error, _request, reply) => {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 413) {
        return reply
          .code(413)
          .send({ code: "payload_too_large", message: "O corpo da chamada é grande demais." });
      }
      if (status === 415) {
        return reply.code(415).send({
          code: "unsupported_media_type",
          message: "Envie o corpo como application/json ou text/plain.",
        });
      }
      if (status !== undefined && status >= 400 && status < 500) {
        return reply.code(400).send({ code: "bad_request", message: "Requisição inválida." });
      }
      // From here on the caller is authenticated or the error is ours: the same mapping as the API.
      const { status: code, body } = toHttpError(error);
      if (code >= 500) this.logger.error(error instanceof Error ? error.message : String(error));
      return reply.code(code).send(body);
    });
    return server;
  }
}

/** A header sent twice arrives as an array or a joined string: either way it is not a valid one. */
function headerOf(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(", ") : value;
}

/** A query parameter sent twice arrives as an array: it is not a valid one. */
function queryValue(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}
