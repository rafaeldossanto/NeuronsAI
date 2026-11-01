import { Inject, Injectable } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
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
      .values({ name, ...value })
      .onConflictDoUpdate({ target: secrets.name, set: { ...value, updatedAt: new Date() } });
  }

  async find(name: string): Promise<EncryptedValue | undefined> {
    const [row] = await this.database.db
      .select({ ciphertext: secrets.ciphertext, iv: secrets.iv, authTag: secrets.authTag })
      .from(secrets)
      .where(eq(secrets.name, name));
    return row;
  }

  async listNames(): Promise<string[]> {
    const rows = await this.database.db
      .select({ name: secrets.name })
      .from(secrets)
      .orderBy(asc(secrets.name));
    return rows.map((row) => row.name);
  }
}
