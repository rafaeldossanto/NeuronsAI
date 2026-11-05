import { z } from "zod";
import { ConfigError } from "./config-error.js";
import { unlessEmpty } from "./env-schema.js";

export interface AuthConfig {
  publicOrigin: string;
  google: { clientId: string; clientSecret: string; redirectUri: string };
}

export const authEnvShape = {
  NEURONS_PUBLIC_ORIGIN: unlessEmpty(z.url().optional()),
  NEURONS_GOOGLE_CLIENT_ID: unlessEmpty(z.string().trim().min(1).optional()),
  NEURONS_GOOGLE_CLIENT_SECRET: unlessEmpty(z.string().trim().min(1).optional()),
  NEURONS_GOOGLE_REDIRECT_URI: unlessEmpty(z.url().optional()),
};
type AuthEnv = z.infer<z.ZodObject<typeof authEnvShape>>;

export function resolveAuth(values: AuthEnv): AuthConfig | undefined {
  const present = Object.values(values).filter(Boolean);
  if (!present.length) return undefined;
  if (present.length !== 4)
    throw new ConfigError([
      "Configure NEURONS_PUBLIC_ORIGIN e as três variáveis NEURONS_GOOGLE_* em conjunto.",
    ]);
  const origin = new URL(values.NEURONS_PUBLIC_ORIGIN!);
  const redirect = new URL(values.NEURONS_GOOGLE_REDIRECT_URI!);
  if (
    origin.origin !== values.NEURONS_PUBLIC_ORIGIN ||
    origin.username ||
    origin.password ||
    (origin.protocol !== "https:" &&
      !(
        origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
      )) ||
    redirect.origin !== origin.origin ||
    redirect.search ||
    redirect.hash ||
    redirect.username ||
    redirect.password ||
    !["/auth/google/callback", "/api/auth/google/callback"].includes(redirect.pathname)
  )
    throw new ConfigError([
      "A origem pública deve usar HTTPS (ou loopback local); o retorno Google deve ser /auth/google/callback ou /api/auth/google/callback na mesma origem.",
    ]);
  return {
    publicOrigin: origin.origin,
    google: {
      clientId: values.NEURONS_GOOGLE_CLIENT_ID!,
      clientSecret: values.NEURONS_GOOGLE_CLIENT_SECRET!,
      redirectUri: redirect.href,
    },
  };
}
