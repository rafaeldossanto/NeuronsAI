import { z } from "zod";
import { defineTool } from "../core/define-tool.js";
import type { ResolvedDeps, ToolNodeOf } from "../core/registry.js";
import { abortFailure, failure, success } from "../core/results.js";
import { SecretNotFoundError, scrubSecrets } from "../core/secrets.js";
import type { ToolResult, ToolSet } from "../core/types.js";
import {
  DestinationBlockedError,
  createGuardedFetch,
  type FetchLike,
} from "../net/guarded-fetch.js";

/** Graph API version of the WhatsApp Cloud API calls (the one Meta's docs use at the time of writing). */
export const WHATSAPP_GRAPH_VERSION = "v27.0";
export const WHATSAPP_GRAPH_BASE_URL = "https://graph.facebook.com";
/** A free-form message is accepted for 24 hours after the customer's last message. */
export const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;
/** The limit of a text message body on WhatsApp. */
export const WHATSAPP_MAX_TEXT_CHARS = 4096;

const ERROR_PREVIEW_CHARS = 200;
const MAX_RESPONSE_CHARS = 20_000;

const WINDOW_CLOSED_MESSAGE =
  "Fora da janela de 24 horas: o cliente não escreve há mais de 24 h, e a Meta só aceita uma mensagem de template aprovado. Templates ainda não são suportados pelo NeuronsAI.";

/** Who the run's reply goes to: the customer whose message started it. */
export interface WhatsAppRecipient {
  /** The customer's number, as the webhook delivered it. Never shown to the agent. */
  to: string;
  /** The business number the customer wrote to. */
  phoneNumberId: string;
  /** When the customer's message was sent: the 24-hour window counts from here. */
  customerWroteAt: Date;
}

/** What the server provides to the WhatsApp tool; absent where there is no WhatsApp conversation. */
export interface WhatsAppDeps {
  /** The customer of the current run, or undefined when the run did not start from a WhatsApp message. */
  recipient(): Promise<WhatsAppRecipient | undefined>;
  /** Replaces `https://graph.facebook.com` (tests only). */
  graphBaseUrl?: string;
  /** Replaces the clock (tests only). */
  now?: () => Date;
}

const replyInput = z.object({
  text: z
    .string()
    .trim()
    .min(1, "o texto não pode ser vazio")
    .max(WHATSAPP_MAX_TEXT_CHARS, `o texto passa de ${String(WHATSAPP_MAX_TEXT_CHARS)} caracteres`),
});

const metaErrorBody = z.object({
  error: z.object({ code: z.number().optional(), message: z.string().optional() }).loose(),
});

/** Long runs of digits could be a phone number: whatever Meta says is kept free of them. */
const hideNumbers = (text: string) => text.replace(/\+?\d[\d\s-]{6,}\d/g, "[número]");

function metaFailure(status: number, body: string, secretValues: string[]): ToolResult {
  let code: number | undefined;
  let detail = "";
  try {
    const parsed = metaErrorBody.safeParse(JSON.parse(body));
    if (parsed.success) {
      code = parsed.data.error.code;
      detail = parsed.data.error.message ?? "";
    }
  } catch {
    // Not JSON: the status says enough.
  }
  switch (code) {
    case 131047:
      return failure("CONFLICT", WINDOW_CLOSED_MESSAGE);
    case 190:
      return failure(
        "HTTP_ERROR",
        "A Meta recusou o access token (expirado ou inválido). Gere um novo token e atualize o segredo.",
      );
    case 131030:
      return failure(
        "HTTP_ERROR",
        "A Meta recusou o destinatário: no número de teste, só números cadastrados na lista de destinatários recebem mensagens.",
      );
    case 130429:
    case 80007:
      return failure("HTTP_ERROR", "A Meta limitou o envio (muitas mensagens). Tente mais tarde.");
    default: {
      const text = scrubSecrets(hideNumbers(detail), secretValues).slice(0, ERROR_PREVIEW_CHARS);
      const where = `HTTP ${String(status)}${code === undefined ? "" : `, código ${String(code)}`}`;
      return failure("HTTP_ERROR", `A Meta recusou o envio (${where})${text ? `: ${text}` : "."}`);
    }
  }
}

export function createWhatsAppTools(
  node: ToolNodeOf<"whatsapp">,
  deps: ResolvedDeps,
): Promise<ToolSet> {
  const config = node.tool;
  // Public servers: graph.facebook.com is a public host, so the guarded fetch lets it through
  // while still refusing anything that resolves to an internal address.
  const doFetch: FetchLike = deps.network ? createGuardedFetch(deps.network) : fetch;
  const whatsapp = deps.whatsapp;
  const now = whatsapp?.now ?? (() => new Date());
  const base = (whatsapp?.graphBaseUrl ?? WHATSAPP_GRAPH_BASE_URL).replace(/\/+$/, "");

  const tool = defineTool({
    name: "send_whatsapp_reply",
    description:
      "Responde, pelo WhatsApp, ao cliente que escreveu a mensagem que iniciou esta execução. " +
      "Você informa só o texto; o destinatário é sempre esse cliente. Só funciona até 24 horas depois da última mensagem dele.",
    schema: replyInput,
    run: async ({ text }, ctx): Promise<ToolResult> => {
      const recipient = await whatsapp?.recipient();
      if (!recipient) {
        return failure(
          "NOT_FOUND",
          "Esta execução não começou por uma mensagem de WhatsApp: não há cliente para responder.",
        );
      }
      if (recipient.phoneNumberId !== config.phoneNumberId) {
        return failure(
          "CONFLICT",
          "O cliente escreveu para outro número do WhatsApp, diferente do configurado nesta ferramenta.",
        );
      }
      if (now().getTime() - recipient.customerWroteAt.getTime() > WHATSAPP_WINDOW_MS) {
        return failure("CONFLICT", WINDOW_CLOSED_MESSAGE);
      }

      const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(deps.limits.httpTimeoutMs)]);
      const secretValues: string[] = [];
      try {
        const token = await ctx.secrets.resolve(config.accessTokenSecret);
        secretValues.push(token);
        const response = await doFetch(
          `${base}/${WHATSAPP_GRAPH_VERSION}/${config.phoneNumberId}/messages`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              recipient_type: "individual",
              to: recipient.to,
              type: "text",
              text: { preview_url: false, body: text },
            }),
            signal,
          },
        );
        const body = (await response.text()).slice(0, MAX_RESPONSE_CHARS);
        return response.ok
          ? success("Mensagem enviada ao cliente.")
          : metaFailure(response.status, body, secretValues);
      } catch (error) {
        if (signal.aborted) return abortFailure(signal);
        if (error instanceof SecretNotFoundError) {
          return failure("SECRET_NOT_FOUND", error.message);
        }
        if (error instanceof DestinationBlockedError) {
          return failure("DESTINATION_BLOCKED", scrubSecrets(error.message, secretValues));
        }
        return failure("NETWORK_ERROR", "Falha de rede ao chamar a API do WhatsApp (Meta).");
      }
    },
  });
  return Promise.resolve({ tools: [tool], close: () => Promise.resolve() });
}
