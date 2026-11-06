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
 *  - 3: graph tools (`list_tools`/`use_tool`) and transient per-agent API credentials.
 *  - 4: terminal resize (`agent.resize` from the server, `agent.resized` back from the runner).
 *       The server sends `agent.resize` only to a runner that announced revision 4 or later, so an
 *       older runner never sees a frame it cannot read; a newer runner talking to an older server
 *       simply never gets one (the terminal stays at its opening size).
 */
export const PROTOCOL_REVISION = 4;
export const REVISION_GRAPH_TOOLS = 3;
export const REVISION_TERMINAL_RESIZE = 4;

/** First revision that understands the `report_tool_call` call. */
export const REVISION_TOOL_CALLS = 2;

/** The revision a peer announced, or 1 when it announced none (it predates revisions). */
export const revisionOf = (announced: number | undefined): number => announced ?? 1;
