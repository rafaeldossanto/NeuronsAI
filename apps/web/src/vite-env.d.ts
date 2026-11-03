/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where the API lives. Defaults to `/api` (the Vite dev proxy). */
  readonly VITE_API_URL?: string;
}
