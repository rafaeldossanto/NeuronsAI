import { Inject, Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";
import type { DatabaseKind } from "../shared/config/app-config.js";

export type DatabaseHealth = "not_configured" | "up" | "down";

export interface HealthReport {
  /** "degraded" when a configured dependency does not answer. */
  status: "ok" | "degraded";
  /** `type` is which database is configured: the embedded PGlite or an external Postgres. */
  database: { type: DatabaseKind; status: DatabaseHealth; message: string };
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async check(): Promise<HealthReport> {
    const type = this.database.kind;
    if (!this.database.isConfigured) {
      return {
        status: "ok",
        database: { type, status: "not_configured", message: "Banco de dados não configurado." },
      };
    }
    try {
      await this.database.ping();
      return {
        status: "ok",
        database: { type, status: "up", message: "Banco de dados respondendo." },
      };
    } catch (error) {
      this.logger.warn(
        `Ping no banco falhou: ${this.database.redactSecrets(error instanceof Error ? error.message : String(error))}`,
      );
      return {
        status: "degraded",
        database: {
          type,
          status: "down",
          message: "Banco de dados configurado, mas não responde.",
        },
      };
    }
  }
}
