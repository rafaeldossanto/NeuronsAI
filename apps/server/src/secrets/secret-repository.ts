import type { EncryptedValue } from "./secret-cipher.js";

export interface SecretRepository {
  /** Creates the secret or replaces its encrypted value. */
  upsert(name: string, value: EncryptedValue): Promise<void>;
  find(name: string): Promise<EncryptedValue | undefined>;
  listNames(): Promise<string[]>;
}

export const SECRET_REPOSITORY = Symbol("SECRET_REPOSITORY");
