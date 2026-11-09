// The protocol between the NeuronsAI server and a runner (the process that hosts the agents'
// runtimes). Zod is the single source: the frames below are both the validation and the types.
export {
  PROTOCOL_REVISION,
  PROTOCOL_VERSION,
  REVISION_TOOL_CALLS,
  REVISION_GRAPH_TOOLS,
  REVISION_TERMINAL_RESIZE,
  REVISION_TERMINAL_SNAPSHOT,
  SUPPORTED_VERSIONS,
  revisionOf,
} from "./version.js";
export * from "./frames.js";
export {
  MAX_FRAME_CHARS,
  decodeRunnerFrame,
  decodeServerFrame,
  encodeFrame,
  type DecodeFailureCode,
  type DecodeResult,
} from "./codec.js";
export {
  CLOSE_HEARTBEAT,
  CLOSE_NOT_ACCEPTED,
  CLOSE_PROTOCOL,
  CLOSE_REPLACED,
  CLOSE_UNAUTHORIZED,
  WireChannel,
  createMemoryChannelPair,
  createRunnerWireChannel,
  createServerWireChannel,
  type CloseInfo,
  type FrameChannel,
  type InvalidFrame,
  type RunnerChannel,
  type ServerChannel,
  type Unsubscribe,
  type WireIo,
} from "./channel.js";
