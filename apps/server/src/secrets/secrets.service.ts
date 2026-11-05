import { Inject, Injectable } from "@nestjs/common";
import { DomainError } from "../shared/errors/domain-error.js";
import { resourceScope } from "../accounts/resource-scope.js";
import { SECRET_CIPHER, type SecretCipher } from "./secret-cipher.js";
import { SECRET_REPOSITORY, type SecretRepository } from "./secret-repository.js";
import {
  InvalidSecretNameError,
  SecretDecryptionError,
  SecretNotFoundError,
} from "./secrets.errors.js";

/** What a secret name may look like; the API validates its path parameter with the same rule. */
export const SECRET_NAME_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/** Encrypted key/value store. Values are never logged or returned by {@link listNames}. */
@Injectable()
export class SecretsService {
  constructor(
    @Inject(SECRET_REPOSITORY) private readonly repository: SecretRepository,
    @Inject(SECRET_CIPHER) private readonly cipher: SecretCipher,
  ) {}

  async set(name: string, value: string): Promise<void> {
    this.assertValidName(name);
    // The name is bound to the ciphertext so a stored value cannot be moved to another name.
    await this.repository.upsert(name, this.cipher.encrypt(value, this.context(name)));
  }

  async get(name: string): Promise<string> {
    this.assertValidName(name);
    const encrypted = await this.repository.find(name);
    if (!encrypted) throw new SecretNotFoundError(name);
    try {
      return this.cipher.decrypt(encrypted, this.context(name));
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new SecretDecryptionError(name);
    }
  }

  /** Removes the secret; returns whether it existed. Nothing here needs the master key. */
  async delete(name: string): Promise<boolean> {
    this.assertValidName(name);
    return this.repository.delete(name);
  }

  listNames(): Promise<string[]> {
    return this.repository.listNames();
  }

  private context(name: string): string {
    const id = resourceScope.current().organizationId;
    return id ? `organization:${id}:${name}` : name;
  }

  private assertValidName(name: string): void {
    if (!SECRET_NAME_PATTERN.test(name)) throw new InvalidSecretNameError();
  }
}
