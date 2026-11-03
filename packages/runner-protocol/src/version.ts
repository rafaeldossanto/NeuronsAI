/**
 * The protocol version both sides speak. Every frame carries it (`v`); a change that an older peer
 * cannot read bumps it. A peer that gets a frame of a version it does not know refuses the
 * connection with `unsupported_protocol` instead of guessing.
 */
export const PROTOCOL_VERSION = 1;

/** Versions this build understands. */
export const SUPPORTED_VERSIONS: readonly number[] = [PROTOCOL_VERSION];
