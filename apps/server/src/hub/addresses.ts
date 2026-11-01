/** You, the person using the app. May write to any agent. */
export const HUMAN = "@human";

/** The run's trigger (manual, webhook, schedule). Writes the first message. */
export const TRIGGER = "@trigger";

/** Not agents, so they never collide with graph names (those cannot contain `@`). */
const EXTERNAL_ADDRESSES: ReadonlySet<string> = new Set([HUMAN, TRIGGER]);

export const isExternalAddress = (address: string): boolean => EXTERNAL_ADDRESSES.has(address);
