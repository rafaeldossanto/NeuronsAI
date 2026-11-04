/**
 * The protocol version both sides speak. Every frame carries it (`v`); a change that an older peer
 * cannot read bumps it. A peer that gets a frame of a version it does not know refuses the
 * connection with `unsupported_protocol` instead of guessing.
 */
export const PROTOCOL_VERSION = 1;

/** Versions this build understands. */
export const SUPPORTED_VERSIONS: readonly number[] = [PROTOCOL_VERSION];

/**
 * The revision inside a version: additions that a peer of an earlier revision simply never sees
 * (an optional field, a call it will not be sent). Each side announces its own (`register` and
 * `registered` carry it; absent means 1) and uses a newer feature only when the other side's
 * revision has it, so a new runner still works with an old server and the other way round.
 *
 *  - 1: the first protocol (T24).
 *  - 2: `report_tool_call` (an agent's tool call goes to the run log as `ToolCalled`).
 */
export const PROTOCOL_REVISION = 2;

/** First revision that understands the `report_tool_call` call. */
export const REVISION_TOOL_CALLS = 2;

/** The revision a peer announced, or 1 when it announced none (it predates revisions). */
export const revisionOf = (announced: number | undefined): number => announced ?? 1;
