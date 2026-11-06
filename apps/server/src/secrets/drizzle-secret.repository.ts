import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import { resourceScope } from "../accounts/resource-scope.js";
import { DatabaseService } from "../database/database.service.js";
import { secrets } from "../database/schema/index.js";
import type { EncryptedValue } from "./secret-cipher.js";
import type { SecretRepository } from "./secret-repository.js";

@Injectable()
export class DrizzleSecretRepository implements SecretRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async upsert(name: string, value: EncryptedValue): Promise<void> {
    await this.database.db
      .insert(secrets)
      .values({ name, ...value, organizationId: resourceScope.current().organizationId })
      .onConflictDoUpdate({
        target: [secrets.organizationId, secrets.name],
        set: { ...value, updatedAt: new Date() },
      });
  }

  async find(name: string): Promise<EncryptedValue | undefined> {
    const [row] = await this.database.db
      .select({ ciphertext: secrets.ciphertext, iv: secrets.iv, authTag: secrets.authTag })
      .from(secrets)
      .where(and(eq(secrets.name, name), resourceScope.matches(secrets.organizationId)));
    return row;
  }

  async listNames(): Promise<string[]> {
    const rows = await this.database.db
      .select({ name: secrets.name })
      .from(secrets)
      .where(resourceScope.matches(secrets.organizationId))
      .orderBy(asc(secrets.name));
    return rows.map((row) => row.name);
  }

  async delete(name: string): Promise<boolean> {
    const removed = await this.database.db
      .delete(secrets)
      .where(and(eq(secrets.name, name), resourceScope.matches(secrets.organizationId)))
      .returning({ id: secrets.id });
    return removed.length > 0;
  }
}
