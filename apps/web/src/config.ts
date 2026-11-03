/** The only module that reads `import.meta.env`. */
const apiPath: string = import.meta.env.VITE_API_URL ?? "/api";

/** Absolute URL of the API: in development `/api` is proxied by Vite to the local server. */
export const apiBaseUrl = new URL(apiPath, window.location.origin).href.replace(/\/$/, "");
