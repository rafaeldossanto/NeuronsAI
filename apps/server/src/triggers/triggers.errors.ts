import { DomainError, type DomainErrorKind } from "../shared/errors/domain-error.js";

/** The graph has no published version, so there is nothing for an external trigger to run. */
export class NoPublishedVersionError extends DomainError {
  readonly kind: DomainErrorKind = "conflict";

  constructor() {
    super(
      "no_published_version",
      "O grafo ainda não tem versão publicada. Publique uma versão para o gatilho poder executá-la.",
    );
  }
}

/** The latest published version has no trigger with that id of the expected kind. */
export class TriggerNotInVersionError extends DomainError {
  readonly kind: DomainErrorKind = "conflict";

  constructor(triggerId: string, kind?: "webhook" | "schedule" | "whatsapp") {
    const as =
      kind === "webhook"
        ? "webhook"
        : kind === "schedule"
          ? "agenda"
          : kind === "whatsapp"
            ? "WhatsApp"
            : "webhook, agenda ou WhatsApp";
    super(
      "trigger_not_in_version",
      `A versão publicada mais recente não tem o gatilho "${triggerId}" como ${as}. Publique o grafo de novo depois de ajustá-lo.`,
    );
  }
}

export class WebhookSecretRequiredError extends DomainError {
  readonly kind: DomainErrorKind = "conflict";

  constructor() {
    super(
      "webhook_secret_required",
      "Gere o segredo do webhook antes de ativá-lo: sem ele nenhuma chamada é aceita.",
    );
  }
}

export class WhatsAppVerifyTokenRequiredError extends DomainError {
  readonly kind: DomainErrorKind = "conflict";

  constructor() {
    super(
      "whatsapp_verify_token_required",
      "Gere o verify token do WhatsApp antes de ativar o gatilho: a Meta precisa dele para confirmar a URL.",
    );
  }
}

export class WhatsAppAppSecretMissingError extends DomainError {
  readonly kind: DomainErrorKind = "conflict";

  constructor(secretName: string) {
    super(
      "whatsapp_app_secret_missing",
      `Cadastre o segredo "${secretName}" (o App Secret do app da Meta) em Segredos antes de ativar o gatilho: sem ele nenhuma mensagem pode ser conferida.`,
    );
  }
}
