export interface SiteEnvironment {
  VITE_WAITLIST_ENABLED?: string;
  VITE_WAITLIST_URL?: string;
}

declare global {
  interface ImportMetaEnv {
    readonly VITE_WAITLIST_ENABLED?: string;
    readonly VITE_WAITLIST_URL?: string;
  }
}

/** The only browser module that reads the environment. No destination means no data collection. */
export function readSiteConfig(environment: SiteEnvironment) {
  let waitlistUrl: string | null = null;
  if (environment.VITE_WAITLIST_ENABLED === "true" && environment.VITE_WAITLIST_URL) {
    try {
      const url = new URL(environment.VITE_WAITLIST_URL);
      if (url.protocol === "https:" && !url.username && !url.password) waitlistUrl = url.href;
    } catch {
      // An invalid configuration keeps the form disabled.
    }
  }
  return { waitlistUrl };
}

export const siteConfig = readSiteConfig(import.meta.env);
