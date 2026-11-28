/** Mirrors the server: whoever may start a run (and so talk to an agent) holds `use` or more. */
export const canRunGraph = (level: string): boolean =>
  level === "use" || level === "edit" || level === "manage";
