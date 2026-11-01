import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { MasterKeyNotConfiguredError } from "./secrets.errors.js";

export interface EncryptedValue {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

export interface SecretCipher {
  /** `context` is authenticated but not encrypted: decrypting with a different one fails. */
  encrypt(plaintext: string, context: string): EncryptedValue;
  /** @throws Error when the key is wrong or the data was tampered with. */
  decrypt(encrypted: EncryptedValue, context: string): string;
}

export const SECRET_CIPHER = Symbol("SECRET_CIPHER");

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12; // recommended nonce size for GCM

export class AesGcmSecretCipher implements SecretCipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== KEY_BYTES) throw new RangeError(`A chave deve ter ${KEY_BYTES} bytes.`);
  }

  encrypt(plaintext: string, context: string): EncryptedValue {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    cipher.setAAD(Buffer.from(context, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return { ciphertext, iv, authTag: cipher.getAuthTag() };
  }

  decrypt({ ciphertext, iv, authTag }: EncryptedValue, context: string): string {
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  }
}

/** Stand-in used when NEURONS_MASTER_KEY is absent, so the server still boots. */
export class UnavailableSecretCipher implements SecretCipher {
  encrypt(): never {
    throw new MasterKeyNotConfiguredError();
  }

  decrypt(): never {
    throw new MasterKeyNotConfiguredError();
  }
}
