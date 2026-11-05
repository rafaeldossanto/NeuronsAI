import { z } from "zod";
import { ConfigError } from "./config-error.js";
import { csvList, unlessEmpty } from "./env-schema.js";

/**
 * Who may create an account on this server. Signup is closed by default: a new identity gets in
 * only through an invitation (see the accounts service) or when its verified e-mail, or the
 * domain of it, is listed here. `open` lifts the restriction and is meant for private servers.
 */
export interface SignupConfig {
  open: boolean;
  allowedDomains: string[];
  allowedEmails: string[];
}

export interface AuthConfig {
  publicOrigin: string;
  signup: SignupConfig;
  google: { clientId: string; clientSecret: string; redirectUri: string };
}

export const authEnvShape = {
  NEURONS_PUBLIC_ORIGIN: unlessEmpty(z.url().optional()),
  NEURONS_GOOGLE_CLIENT_ID: unlessEmpty(z.string().trim().min(1).optional()),
  NEURONS_GOOGLE_CLIENT_SECRET: unlessEmpty(z.string().trim().min(1).optional()),
  NEURONS_GOOGLE_REDIRECT_URI: unlessEmpty(z.url().optional()),
  NEURONS_SIGNUP_ALLOWED_DOMAINS: csvList(),
  NEURONS_SIGNUP_ALLOWED_EMAILS: csvList(),
  NEURONS_SIGNUP_OPEN: unlessEmpty(
    z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
  ),
};
type AuthEnv = z.infer<z.ZodObject<typeof authEnvShape>>;

export function resolveAuth(values: AuthEnv): AuthConfig | undefined {
  const present = [
    values.NEURONS_PUBLIC_ORIGIN,
    values.NEURONS_GOOGLE_CLIENT_ID,
    values.NEURONS_GOOGLE_CLIENT_SECRET,
    values.NEURONS_GOOGLE_REDIRECT_URI,
  ].filter(Boolean);
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
  const allowedDomains = values.NEURONS_SIGNUP_ALLOWED_DOMAINS.map((domain) =>
    domain.replace(/^@/, ""),
  );
  const allowedEmails = values.NEURONS_SIGNUP_ALLOWED_EMAILS;
  if (
    allowedDomains.some((domain) => !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) ||
    allowedEmails.some((email) => !z.email().safeParse(email).success)
  )
    throw new ConfigError([
      "NEURONS_SIGNUP_ALLOWED_DOMAINS deve listar domínios (exemplo.com) e NEURONS_SIGNUP_ALLOWED_EMAILS, e-mails completos.",
    ]);
  return {
    publicOrigin: origin.origin,
    signup: { open: values.NEURONS_SIGNUP_OPEN, allowedDomains, allowedEmails },
    google: {
      clientId: values.NEURONS_GOOGLE_CLIENT_ID!,
      clientSecret: values.NEURONS_GOOGLE_CLIENT_SECRET!,
      redirectUri: redirect.href,
    },
  };
}
