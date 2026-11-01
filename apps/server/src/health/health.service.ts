import { Inject, Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";

export type DatabaseHealth = "not_configured" | "up" | "down";

export interface HealthReport {
  /** "degraded" when a configured dependency does not answer. */
  status: "ok" | "degraded";
  database: { status: DatabaseHealth; message: string };
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async check(): Promise<HealthReport> {
    if (!this.database.isConfigured) {
      return {
        status: "ok",
        database: { status: "not_configured", message: "Banco de dados não configurado." },
      };
    }
    try {
      await this.database.ping();
      return { status: "ok", database: { status: "up", message: "Banco de dados respondendo." } };
    } catch (error) {
      this.logger.warn(
        `Ping no banco falhou: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        status: "degraded",
        database: { status: "down", message: "Banco de dados configurado, mas não responde." },
      };
    }
  }
}
