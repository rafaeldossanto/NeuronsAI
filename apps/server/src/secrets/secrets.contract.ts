import { z } from "zod";
import { SECRET_NAME_PATTERN } from "./secrets.service.js";

/** The largest secret accepted (an RSA key or a long token fit with room to spare). */
export const SECRET_VALUE_MAX_CHARS = 16_384;

export const secretParams = z.object({
  name: z.string().regex(SECRET_NAME_PATTERN, {
    error: "Use de 1 a 128 caracteres entre letras, números, '.', '_' e '-'.",
  }),
});

/** Write-only: the value goes in here and never comes back out of any endpoint. */
export const writeSecretBody = z.object({
  value: z.string().min(1).max(SECRET_VALUE_MAX_CHARS),
});

/** Names only. A secret's value has no schema that could carry it. */
export const secretNamesSchema = z.object({ names: z.array(z.string()) });

export type SecretParams = z.infer<typeof secretParams>;
export type WriteSecretBody = z.infer<typeof writeSecretBody>;
