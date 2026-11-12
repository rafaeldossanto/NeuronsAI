import { createHmac } from "node:crypto";
import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError, type DomainErrorKind } from "../shared/errors/domain-error.js";
import {
  WHATSAPP_APP_SECRET_NAME,
  WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_TRIGGER,
  createTriggerRig,
  graphWithWhatsApp,
} from "./testing/trigger-rig.js";
import { WHATSAPP_CONTACT_MEMORY_MS, WHATSAPP_RESEND_MEMORY_MS } from "./whatsapp-messages.js";

const APP_SECRET = "meta-app-secret-for-tests";
const CUSTOMER = "5511987654321";
const CUSTOMER_NAME = "Maria da Silva";
const TEXT = "Quero saber do meu pedido 4521";

const nowSec = () => Math.floor(Date.now() / 1000);

function message(overrides: Record<string, unknown> = {}) {
  return {
    from: CUSTOMER,
    id: `wamid.${Math.random().toString(36).slice(2)}`,
    timestamp: String(nowSec()),
    type: "text",
    text: { body: TEXT },
    ...overrides,
  };
}

function notification(messages: unknown[], phoneNumberId = WHATSAPP_PHONE_NUMBER_ID) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550000000", phone_number_id: phoneNumberId },
              contacts: [{ profile: { name: CUSTOMER_NAME }, wa_id: CUSTOMER }],
              messages,
            },
          },
        ],
      },
    ],
  });
}

function statusNotification() {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: WHATSAPP_PHONE_NUMBER_ID },
              statuses: [
                { id: "wamid.out", status: "delivered", timestamp: "1", recipient_id: CUSTOMER },
              ],
            },
          },
        ],
      },
    ],
  });
}

const sign = (body: string, secret = APP_SECRET) =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

async function readyRig() {
  const rig = await createTriggerRig();
  await rig.secrets.set(WHATSAPP_APP_SECRET_NAME, APP_SECRET);
  await rig.publish(graphWithWhatsApp());
  const { secret: verifyToken, view } = await rig.triggers.rotateSecret(
    rig.graph.id,
    WHATSAPP_TRIGGER,
  );
  await rig.triggers.setEnabled(rig.graph.id, WHATSAPP_TRIGGER, true);
  return { ...rig, verifyToken, hookId: view.hookId as string };
}

type Rig = Awaited<ReturnType<typeof readyRig>>;

const post = (rig: Rig, body: string, signature: string | undefined = sign(body)) =>
  rig.whatsapp.receive({ hookId: rig.hookId, signatureHeader: signature, body: Buffer.from(body) });

describe("WhatsAppService: verificação do webhook (GET)", () => {
  it("devolve o hub.challenge só com o verify token gerado pelo servidor", async () => {
    const rig = await readyRig();
    const ok = await rig.whatsapp.verify({
      hookId: rig.hookId,
      mode: "subscribe",
      verifyToken: rig.verifyToken,
      challenge: "1158201444",
    });
    expect(ok).toEqual({ kind: "challenge", challenge: "1158201444" });
  });

  it.each([
    ["token errado", { verifyToken: "vt_errado" }],
    ["sem token", { verifyToken: undefined }],
    ["modo diferente de subscribe", { mode: "unsubscribe" }],
    ["sem challenge", { challenge: undefined }],
    ["challenge com caracteres de HTML", { challenge: "<script>alert(1)</script>" }],
  ])("recusa: %s", async (_name, change) => {
    const rig = await readyRig();
    const result = await rig.whatsapp.verify({
      hookId: rig.hookId,
      mode: "subscribe",
      verifyToken: rig.verifyToken,
      challenge: "123",
      ...change,
    });
    expect(result).toEqual({ kind: "forbidden" });
  });

  it("recusa id desconhecido", async () => {
    const rig = await readyRig();
    expect(
      await rig.whatsapp.verify({
        hookId: "inexistente",
        mode: "subscribe",
        verifyToken: rig.verifyToken,
        challenge: "1",
      }),
    ).toEqual({ kind: "forbidden" });
  });

  it("confirma antes de ativar o gatilho, mas só com o gatilho na versão publicada", async () => {
    const rig = await createTriggerRig();
    const { secret, view } = await rig.triggers.rotateSecret(rig.graph.id, WHATSAPP_TRIGGER);
    const verify = () =>
      rig.whatsapp.verify({
        hookId: view.hookId as string,
        mode: "subscribe",
        verifyToken: secret,
        challenge: "9",
      });
    expect(await verify()).toEqual({ kind: "forbidden" }); // nada publicado
    await rig.publish(graphWithWhatsApp());
    expect(await verify()).toEqual({ kind: "challenge", challenge: "9" }); // desativado, mas confirma
  });
});

describe("WhatsAppService: mensagens (POST)", () => {
  let rig: Rig;
  beforeEach(async () => {
    rig = await readyRig();
  });

  it("uma mensagem assinada inicia uma execução da versão publicada mais recente, com o texto do cliente", async () => {
    const latest = await rig.publish(graphWithWhatsApp());
    const body = notification([message()]);

    const result = await post(rig, body);

    expect(result).toEqual({ kind: "received", started: 1 });
    expect(rig.runService.starts).toHaveLength(1);
    const start = rig.runService.starts[0]!;
    expect(start.versionId).toBe(latest.id);
    expect(start.triggerId).toBe(WHATSAPP_TRIGGER);
    expect(start.input).toContain(TEXT);
    expect(start.input).toMatch(/não como instrução do sistema/);
    // The agent gets the words and nothing else: not the number, not the profile name.
    expect(start.input).not.toContain(CUSTOMER);
    expect(start.input).not.toContain(CUSTOMER_NAME);

    const state = await rig.triggers.get(rig.graph.id, WHATSAPP_TRIGGER);
    expect(state).toMatchObject({ lastOutcome: "started", lastNote: null });
  });

  it("guarda o telefone só para responder e liga a execução à mensagem", async () => {
    await post(rig, notification([message({ id: "wamid.guardada" })]));
    const runId = rig.runService.records.keys().next().value as string;
    expect(await rig.whatsappMessages.contactOfRun(runId)).toMatchObject({
      to: CUSTOMER,
      phoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
    });
  });

  it.each([
    ["assinatura de outro segredo", (body: string) => sign(body, "outro-segredo")],
    ["assinatura sobre outro corpo", () => sign("{}")],
    ["sem cabeçalho", () => undefined],
    ["prefixo errado", (body: string) => sign(body).replace("sha256=", "sha1=")],
    ["hex curto", () => "sha256=abcd"],
  ])("recusa com 401 genérico e sem execução: %s", async (_name, signer) => {
    const body = notification([message()]);
    const result = await rig.whatsapp.receive({
      hookId: rig.hookId,
      signatureHeader: signer(body),
      body: Buffer.from(body),
    });
    expect(result).toEqual({ kind: "unauthorized" });
    expect(rig.runService.starts).toHaveLength(0);
    expect(rig.whatsappMessages.rows.size).toBe(0);
  });

  it("confere a assinatura sobre o corpo cru, byte a byte", async () => {
    const body = notification([message()]);
    const reformatted = JSON.stringify(JSON.parse(body), null, 2);
    expect(await post(rig, reformatted, sign(body))).toEqual({ kind: "unauthorized" });
  });

  it("recusa gatilho desativado, mesmo com assinatura certa", async () => {
    await rig.triggers.setEnabled(rig.graph.id, WHATSAPP_TRIGGER, false);
    expect(await post(rig, notification([message()]))).toEqual({ kind: "unauthorized" });
    expect(rig.runService.starts).toHaveLength(0);
  });

  it("recusa quando o App Secret não está no cofre", async () => {
    await rig.secrets.delete(WHATSAPP_APP_SECRET_NAME);
    expect(await post(rig, notification([message()]))).toEqual({ kind: "unauthorized" });
  });

  it("a mesma mensagem reenviada pela Meta inicia uma execução só", async () => {
    const body = notification([message({ id: "wamid.repetida" })]);
    expect(await post(rig, body)).toEqual({ kind: "received", started: 1 });
    expect(await post(rig, body)).toEqual({ kind: "received", started: 0 });
    // Resent in another envelope, with another signature: the message id is what counts.
    const again = notification([message({ id: "wamid.repetida" })]);
    expect(await post(rig, again)).toEqual({ kind: "received", started: 0 });
    expect(rig.runService.starts).toHaveLength(1);
  });

  it("duas mensagens diferentes na mesma notificação iniciam duas execuções", async () => {
    const body = notification([message({ id: "wamid.a" }), message({ id: "wamid.b" })]);
    expect(await post(rig, body)).toEqual({ kind: "received", started: 2 });
    expect(rig.runService.starts).toHaveLength(2);
  });

  it("status de entrega é aceito e ignorado, sem execução", async () => {
    expect(await post(rig, statusNotification())).toEqual({ kind: "received", started: 0 });
    expect(rig.runService.starts).toHaveLength(0);
  });

  it("ignora mensagem enviada a outro número da mesma conta", async () => {
    const body = notification([message()], "999999999999");
    expect(await post(rig, body)).toEqual({ kind: "received", started: 0 });
    expect(rig.runService.starts).toHaveLength(0);
  });

  it("ignora o que não é texto, texto vazio e mensagem sem remetente", async () => {
    const body = notification([
      message({ id: "wamid.img", type: "image", text: undefined }),
      message({ id: "wamid.vazio", text: { body: "   " } }),
      message({ id: "wamid.anonima", from: undefined }),
    ]);
    expect(await post(rig, body)).toEqual({ kind: "received", started: 0 });
  });

  it("ignora mensagem velha demais (replay de algo capturado)", async () => {
    const old = String(nowSec() - 8 * 24 * 60 * 60);
    const body = notification([message({ timestamp: old })]);
    expect(await post(rig, body)).toEqual({ kind: "received", started: 0 });
  });

  it("aceita e ignora JSON ou formato que não é da Meta, desde que assinado", async () => {
    expect(await post(rig, "isto não é json")).toEqual({ kind: "received", started: 0 });
    expect(await post(rig, JSON.stringify({ object: "page", entry: [] }))).toEqual({
      kind: "received",
      started: 0,
    });
  });

  it("um erro nosso ao iniciar a execução solta a mensagem, para o reenvio da Meta tentar de novo", async () => {
    const body = notification([message({ id: "wamid.falha" })]);
    rig.runService.failWith = new Error("banco indisponível");
    await expect(post(rig, body)).rejects.toThrow("banco indisponível");
    expect(rig.whatsappMessages.rows.size).toBe(0);

    expect(await post(rig, body)).toEqual({ kind: "received", started: 1 });
  });

  it("um erro do grafo (DomainError) não faz a Meta reenviar: 200 e a nota no gatilho", async () => {
    class GraphProblem extends DomainError {
      readonly kind: DomainErrorKind = "conflict";
      constructor() {
        super("graph_problem", "O grafo não pode rodar agora.");
      }
    }
    const body = notification([message({ id: "wamid.grafo" })]);
    rig.runService.failWith = new GraphProblem();
    expect(await post(rig, body)).toEqual({ kind: "received", started: 0 });
    expect(await post(rig, body)).toEqual({ kind: "received", started: 0 });
    expect(await rig.triggers.get(rig.graph.id, WHATSAPP_TRIGGER)).toMatchObject({
      lastOutcome: "failed",
      lastNote: "O grafo não pode rodar agora.",
    });
  });

  it("limita as chamadas por gatilho (429)", async () => {
    const limited = await createTriggerRig({ ratePerMinute: 2 });
    await limited.secrets.set(WHATSAPP_APP_SECRET_NAME, APP_SECRET);
    await limited.publish(graphWithWhatsApp());
    const { view } = await limited.triggers.rotateSecret(limited.graph.id, WHATSAPP_TRIGGER);
    await limited.triggers.setEnabled(limited.graph.id, WHATSAPP_TRIGGER, true);
    const body = statusNotification();
    const call = () =>
      limited.whatsapp.receive({
        hookId: view.hookId as string,
        signatureHeader: sign(body),
        body: Buffer.from(body),
      });
    await call();
    await call();
    expect(await call()).toMatchObject({ kind: "rate_limited" });
  });

  describe("dado pessoal", () => {
    const logged: string[] = [];
    beforeEach(() => {
      logged.length = 0;
      for (const level of ["log", "warn", "error", "debug", "verbose"] as const) {
        vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
          logged.push(args.map(String).join(" "));
        });
      }
    });
    afterEach(() => vi.restoreAllMocks());

    it("nunca vai ao log: telefone, nome, texto, segredos ou assinatura", async () => {
      await post(rig, notification([message({ id: "wamid.log" })]));
      await post(rig, notification([message()]), "sha256=" + "0".repeat(64));
      rig.runService.failWith = new Error(`falha com ${CUSTOMER}`);
      await post(rig, notification([message({ id: "wamid.log2" })])).catch(() => undefined);
      await rig.whatsapp.verify({
        hookId: rig.hookId,
        mode: "subscribe",
        verifyToken: "errado",
        challenge: "1",
      });

      const everything = logged.join("\n");
      expect(everything).not.toBe("");
      for (const secret of [CUSTOMER, CUSTOMER_NAME, "pedido 4521", APP_SECRET, rig.verifyToken]) {
        expect(everything).not.toContain(secret);
      }
      expect(everything).not.toContain(rig.hookId);
    });
  });

  it("limpa o telefone depois da janela e esquece a mensagem quando a Meta não reenvia mais", async () => {
    const received = new Date("2026-11-01T10:00:00Z");
    await rig.whatsappMessages.claim({
      hookId: rig.hookId,
      messageId: "wamid.velha",
      phoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
      contact: CUSTOMER,
      sentAt: received,
      receivedAt: received,
    });
    await rig.whatsappMessages.attachRun(rig.hookId, "wamid.velha", "run-1");

    await rig.whatsappMessages.purge(new Date(received.getTime() + WHATSAPP_CONTACT_MEMORY_MS + 1));
    expect(await rig.whatsappMessages.contactOfRun("run-1")).toBeUndefined();
    expect(rig.whatsappMessages.rows.has(`${rig.hookId}/wamid.velha`)).toBe(true); // still deduplicates

    await rig.whatsappMessages.purge(new Date(received.getTime() + WHATSAPP_RESEND_MEMORY_MS + 1));
    expect(rig.whatsappMessages.rows.size).toBe(0);
  });
});

describe("TriggersService: gatilho do WhatsApp", () => {
  it("gera um verify token (vt_) em vez do segredo HMAC quando o rascunho tem um gatilho WhatsApp", async () => {
    const rig = await createTriggerRig();
    await rig.graphs.update(rig.graph.id, { draft: { ...graphWithWhatsApp(), id: rig.graph.id } });
    const { secret } = await rig.triggers.rotateSecret(rig.graph.id, WHATSAPP_TRIGGER);
    expect(secret.startsWith("vt_")).toBe(true);
  });

  it("só ativa com o verify token gerado e o App Secret cadastrado, dizendo o que falta", async () => {
    const rig = await createTriggerRig();
    await rig.publish(graphWithWhatsApp());
    await expect(rig.triggers.setEnabled(rig.graph.id, WHATSAPP_TRIGGER, true)).rejects.toThrow(
      /verify token/,
    );
    await rig.triggers.rotateSecret(rig.graph.id, WHATSAPP_TRIGGER);
    await expect(rig.triggers.setEnabled(rig.graph.id, WHATSAPP_TRIGGER, true)).rejects.toThrow(
      new RegExp(WHATSAPP_APP_SECRET_NAME),
    );
    await rig.secrets.set(WHATSAPP_APP_SECRET_NAME, APP_SECRET);
    expect((await rig.triggers.setEnabled(rig.graph.id, WHATSAPP_TRIGGER, true)).enabled).toBe(
      true,
    );
  });
});
