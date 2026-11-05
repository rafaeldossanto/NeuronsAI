import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.service.js";
import { graphTriggers, secrets } from "../database/schema/index.js";

/**
 * Removes webhook secrets that no trigger points to any more. Before graphs deleted their secrets
 * (see `DrizzleGraphRepository.delete`) a graph that was never published could be deleted and leave
 * its secret behind. The routine runs when the app starts, is idempotent (a second run finds
 * nothing) and is deliberately narrow: only a name that is exactly `webhook.` plus a generated hook
 * id (22 base64url characters) with no `graph_triggers` row is touched, so a secret a user named
 * by hand is never taken for an orphan.
 */
@Injectable()
export class OrphanWebhookSecrets implements OnApplicationBootstrap {
  private readonly logger = new Logger(OrphanWebhookSecrets.name);

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.database.isConfigured) return;
    try {
      const removed = await this.purge();
      if (removed > 0) {
        this.logger.log(`${removed} segredo(s) de webhook órfão(s) removido(s).`);
      }
    } catch {
      // A failed cleanup must never stop the app from starting; the next start tries again.
      this.logger.warn("Não foi possível limpar os segredos de webhook órfãos.");
    }
  }

  /** Returns how many orphans were removed. */
  async purge(): Promise<number> {
    const removed = await this.database.db
      .delete(secrets)
      .where(
        sql`${secrets.name} ~ '^webhook[.][A-Za-z0-9_-]{22}$' and not exists (
          select 1 from ${graphTriggers} where 'webhook.' || ${graphTriggers.hookId} = ${secrets.name}
        )`,
      )
      .returning({ id: secrets.id });
    return removed.length;
  }
}
