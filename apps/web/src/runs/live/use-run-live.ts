import { useCallback, useEffect, useReducer, useRef } from "react";
import { useApi } from "@/shared/api";
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
  | { type: "events"; events: readonly RunLiveEvent[] }
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
    case "events": {
      const state = action.events.reduce(reduceRunEvent, model.state);
      return state === model.state ? model : { ...model, state };
    }
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
  /** Tells the server how big the screen of the agent's terminal is here (`terminal.resize`). */
  sendTerminalResize: (agent: string, cols: number, rows: number) => boolean;
  clearInputError: () => void;
} {
  const [model, dispatch] = useReducer(reducer, initialModel);
  const clientRef = useRef<RunLiveClient | null>(null);
  const api = useApi();

  useEffect(() => {
    dispatch({ type: "reset" });
    if (!runId) return;
    // The socket can deliver many messages per frame (terminal output above all): collect them and
    // dispatch one batch per animation frame, so React renders once instead of once per message.
    let queue: RunLiveEvent[] = [];
    let frame: number | null = null;
    const flush = () => {
      frame = null;
      if (queue.length === 0) return;
      const events = queue;
      queue = [];
      dispatch({ type: "events", events });
    };
    const client = new RunLiveClient({
      runId,
      url: defaultSocketUrl(window.location),
      // Any API call that meets an expired session renews the cookies (see sessionFetch).
      renewSession: async () => {
        await api.GET("/auth/session");
      },
      onEvent: (event) => {
        queue.push(event);
        frame ??= requestAnimationFrame(flush);
      },
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
      if (frame !== null) cancelAnimationFrame(frame);
      queue = [];
    };
  }, [runId, api]);

  const sendTerminalInput = useCallback((agent: string, data: string) => {
    return clientRef.current?.sendTerminalInput(agent, data) ?? false;
  }, []);
  const sendTerminalResize = useCallback((agent: string, cols: number, rows: number) => {
    return clientRef.current?.sendTerminalResize(agent, cols, rows) ?? false;
  }, []);
  const clearInputError = useCallback(() => dispatch({ type: "inputError", inputError: null }), []);

  return {
    state: model.state,
    connection: model.connection,
    error: model.error,
    inputError: model.inputError,
    sendTerminalInput,
    sendTerminalResize,
    clearInputError,
  };
}
