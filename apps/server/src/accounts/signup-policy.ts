import type { SignupConfig } from "../shared/config/auth-config.js";

export const SIGNUP_POLICY = Symbol("SIGNUP_POLICY");

/**
 * Who may create an account. A server reachable from the internet must not turn every Google
 * account into an organization owner, so the default is closed: only a verified e-mail that is
 * listed (or whose domain is listed) may sign up on its own. Everyone else needs an invitation,
 * which the accounts service checks separately.
 */
export class SignupPolicy {
  constructor(private readonly config: SignupConfig) {}

  static open(): SignupPolicy {
    return new SignupPolicy({ open: true, allowedDomains: [], allowedEmails: [] });
  }

  static closed(): SignupPolicy {
    return new SignupPolicy({ open: false, allowedDomains: [], allowedEmails: [] });
  }

  /** `email` must be one the identity provider verified; without it only an open policy admits. */
  allows(email: string | undefined): boolean {
    if (this.config.open) return true;
    if (!email) return false;
    const normalized = normalizeEmail(email);
    if (this.config.allowedEmails.includes(normalized)) return true;
    const domain = normalized.slice(normalized.lastIndexOf("@") + 1);
    return this.config.allowedDomains.includes(domain);
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
