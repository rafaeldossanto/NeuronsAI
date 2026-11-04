import { useCallback, useEffect, useReducer, useRef } from "react";
import { reduceRunEvent, initialRunLiveState } from "./reduce-run-event";
import { defaultSocketUrl, RunLiveClient } from "./run-live-client";
import { terminalInputError, type TerminalInputError } from "./terminal-errors";
import type { ConnectionState, RunLiveEvent, RunLiveState } from "./types";

interface Model {
  state: RunLiveState;
  connection: ConnectionState;
  error: string | null;
  /** Why the server refused the last `terminal.input`, if it did. */
  inputError: TerminalInputError | null;
}

type Action =
  | { type: "reset" }
  | { type: "event"; event: RunLiveEvent }
  | { type: "connection"; connection: ConnectionState }
  | { type: "error"; error: string | null }
  | { type: "inputError"; inputError: TerminalInputError | null };

const initialModel: Model = {
  state: initialRunLiveState,
  connection: "connecting",
  error: null,
  inputError: null,
};

function reducer(model: Model, action: Action): Model {
  switch (action.type) {
    case "reset":
      return initialModel;
    case "event":
      return { ...model, state: reduceRunEvent(model.state, action.event) };
    case "connection":
      return { ...model, connection: action.connection };
    case "error":
      return { ...model, error: action.error };
    case "inputError":
      return { ...model, inputError: action.inputError };
  }
}

/**
 * Follows a run live: its state, the state of the connection, the last error the server sent and a
 * way to type into an agent's terminal.
 */
export function useRunLive(runId: string): {
  state: RunLiveState;
  connection: ConnectionState;
  error: string | null;
  inputError: TerminalInputError | null;
  /** Sends keystrokes to the agent's terminal; false when there is no open connection. */
  sendTerminalInput: (agent: string, data: string) => boolean;
  clearInputError: () => void;
} {
  const [model, dispatch] = useReducer(reducer, initialModel);
  const clientRef = useRef<RunLiveClient | null>(null);

  useEffect(() => {
    dispatch({ type: "reset" });
    if (!runId) return;
    const client = new RunLiveClient({
      runId,
      url: defaultSocketUrl(window.location),
      onEvent: (event) => dispatch({ type: "event", event }),
      onConnection: (connection) => dispatch({ type: "connection", connection }),
      onError: (error, code) => {
        const refused = terminalInputError(code);
        if (refused) dispatch({ type: "inputError", inputError: refused });
        else dispatch({ type: "error", error });
      },
    });
    clientRef.current = client;
    client.start();
    return () => {
      clientRef.current = null;
      client.close();
    };
  }, [runId]);

  const sendTerminalInput = useCallback((agent: string, data: string) => {
    return clientRef.current?.sendTerminalInput(agent, data) ?? false;
  }, []);
  const clearInputError = useCallback(() => dispatch({ type: "inputError", inputError: null }), []);

  return {
    state: model.state,
    connection: model.connection,
    error: model.error,
    inputError: model.inputError,
    sendTerminalInput,
    clearInputError,
  };
}
