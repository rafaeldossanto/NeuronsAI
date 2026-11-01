export type ToolSetupErrorCode =
  "UNSUPPORTED_KIND" | "INVALID_CONFIG" | "CONNECTION_FAILED" | "SECRET_NOT_FOUND";

/** Raised by `createTools` when a tool block cannot be turned into a usable `ToolSet`. */
export class ToolSetupError extends Error {
  constructor(
    readonly code: ToolSetupErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ToolSetupError";
  }
}
