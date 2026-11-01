import type { EncryptedValue } from "../secret-cipher.js";
import type { SecretRepository } from "../secret-repository.js";

export class InMemorySecretRepository implements SecretRepository {
  readonly stored = new Map<string, EncryptedValue>();

  upsert(name: string, value: EncryptedValue): Promise<void> {
    this.stored.set(name, value);
    return Promise.resolve();
  }

  find(name: string): Promise<EncryptedValue | undefined> {
    return Promise.resolve(this.stored.get(name));
  }

  listNames(): Promise<string[]> {
    return Promise.resolve([...this.stored.keys()].sort());
  }
}
