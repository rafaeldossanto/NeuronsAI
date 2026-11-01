import { DomainError, type DomainErrorKind } from "../shared/errors/domain-error.js";

export class DatabaseNotConfiguredError extends DomainError {
  readonly kind: DomainErrorKind = "unavailable";

  constructor() {
    super(
      "database_not_configured",
      "Banco de dados não configurado. Defina NEURONS_DB_URL (ou NEURONS_DB_HOST, NEURONS_DB_USER, NEURONS_DB_NAME e NEURONS_DB_PASSWORD).",
    );
  }
}
