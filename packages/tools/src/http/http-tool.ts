import type { ReadableStreamReadResult } from "node:stream/web";
import { Ajv, type ValidateFunction } from "ajv";
import { z } from "zod";
import { defineTool } from "../core/define-tool.js";
import { ToolSetupError } from "../core/errors.js";
import type { ResolvedDeps, ToolNodeOf } from "../core/registry.js";
import { abortFailure, failure, success } from "../core/results.js";
import { SecretNotFoundError, scrubSecrets } from "../core/secrets.js";
import type { JsonSchema, Tool, ToolContext, ToolResult, ToolSet } from "../core/types.js";
import {
  DestinationBlockedError,
  createGuardedFetch,
  type FetchLike,
} from "../net/guarded-fetch.js";
import { buildRequest, InvalidUrlError, type RequestTemplate } from "./request.js";

const MAX_TOOL_NAME_LENGTH = 64;
const ERROR_BODY_PREVIEW_CHARS = 500;
const BODYLESS_METHODS = new Set(["GET"]);

type HttpConfig = ToolNodeOf<"http">["tool"];

const noInput = z.object({}).strict();
const bodyInput = z.object({ body: z.unknown().optional() });

/** Provider-safe tool name derived from the block name. */
export function toolNameFor(blockName: string): string {
  const cleaned = blockName
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned.slice(0, MAX_TOOL_NAME_LENGTH) || "http_request";
}

interface BodyValidator {
  validate: ValidateFunction;
  describeErrors(): string;
}

function compileBodySchema(schema: unknown): BodyValidator | undefined {
  if (schema === undefined || schema === null) return undefined;
  const ajv = new Ajv({ strict: false, logger: false });
  try {
    const validate = ajv.compile(schema);
    return { validate, describeErrors: () => ajv.errorsText(validate.errors, { dataVar: "body" }) };
  } catch (cause) {
    throw new ToolSetupError("INVALID_CONFIG", "O bodySchema da ferramenta HTTP é inválido.", {
      cause,
    });
  }
}

function inputSchemaFor(config: HttpConfig): JsonSchema {
  if (BODYLESS_METHODS.has(config.method)) {
    return { type: "object", properties: {}, additionalProperties: false };
  }
  const hasSchema = config.bodySchema !== undefined && config.bodySchema !== null;
  return {
    type: "object",
    properties: { body: hasSchema ? (config.bodySchema as JsonSchema) : {} },
    required: hasSchema ? ["body"] : [],
    additionalProperties: false,
  };
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (received < maxBytes) {
    const { done, value } = (await reader.read()) as ReadableStreamReadResult<Uint8Array>;
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function networkCode(error: unknown): string {
  const cause: unknown = error instanceof Error ? error.cause : undefined;
  const code = cause instanceof Error && "code" in cause ? String(cause.code) : undefined;
  return code ?? "sem detalhes";
}

class HttpTool {
  private readonly template: RequestTemplate;

  constructor(
    private readonly config: HttpConfig,
    private readonly bodyValidator: BodyValidator | undefined,
    private readonly limits: ResolvedDeps["limits"],
    private readonly doFetch: FetchLike,
  ) {
    this.template = { url: config.url, headers: config.headers };
  }

  async run(input: { body?: unknown }, ctx: ToolContext): Promise<ToolResult> {
    const bodyProblem = this.checkBody(input.body);
    if (bodyProblem) return bodyProblem;

    const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(this.limits.httpTimeoutMs)]);
    let secretValues: string[] = [];
    try {
      const request = await buildRequest(this.template, input.body, ctx.secrets);
      secretValues = request.secretValues;
      const response = await this.doFetch(request.url, {
        method: this.config.method,
        headers: request.headers,
        ...(request.body === undefined ? {} : { body: request.body }),
        signal,
      });
      const text = await readCapped(response, this.limits.maxResultChars * 4 + 4);
      return this.toResult(response, scrubSecrets(text, secretValues));
    } catch (error) {
      return this.toFailure(error, signal, secretValues);
    }
  }

  private checkBody(body: unknown): ToolResult | undefined {
    if (this.bodyValidator && !this.bodyValidator.validate(body)) {
      return failure("INVALID_INPUT", `Corpo inválido — ${this.bodyValidator.describeErrors()}`);
    }
    return undefined;
  }

  private toResult(response: Response, text: string): ToolResult {
    if (response.ok) return success(text || `HTTP ${response.status} (sem conteúdo)`);
    const preview = text.slice(0, ERROR_BODY_PREVIEW_CHARS);
    return failure(
      "HTTP_ERROR",
      `HTTP ${response.status} ${response.statusText}`.trim() + (preview ? `: ${preview}` : ""),
    );
  }

  private toFailure(error: unknown, signal: AbortSignal, secretValues: string[]): ToolResult {
    if (signal.aborted) return abortFailure(signal);
    if (error instanceof SecretNotFoundError) return failure("SECRET_NOT_FOUND", error.message);
    if (error instanceof InvalidUrlError) return failure("INVALID_INPUT", error.message);
    if (error instanceof DestinationBlockedError) {
      return failure("DESTINATION_BLOCKED", scrubSecrets(error.message, secretValues));
    }
    return failure(
      "NETWORK_ERROR",
      scrubSecrets(`Falha de rede ao chamar a API (${networkCode(error)}).`, secretValues),
    );
  }
}

export function createHttpTools(node: ToolNodeOf<"http">, deps: ResolvedDeps): Promise<ToolSet> {
  const config = node.tool;
  const doFetch: FetchLike = deps.network ? createGuardedFetch(deps.network) : fetch;
  const handler = new HttpTool(config, compileBodySchema(config.bodySchema), deps.limits, doFetch);
  const bodiless = BODYLESS_METHODS.has(config.method);
  const tool: Tool = defineTool({
    name: toolNameFor(node.name),
    description: `Faz uma requisição ${config.method} à API "${node.name}".`,
    schema: bodiless ? noInput : bodyInput,
    inputSchema: inputSchemaFor(config),
    run: (input, ctx) => handler.run(input, ctx),
  });
  return Promise.resolve({ tools: [tool], close: () => Promise.resolve() });
}
