import { useEffect, useReducer } from "react";
import { reduceRunEvent, initialRunLiveState } from "./reduce-run-event";
import { defaultSocketUrl, RunLiveClient } from "./run-live-client";
import type { ConnectionState, RunLiveEvent, RunLiveState } from "./types";

interface Model {
  state: RunLiveState;
  connection: ConnectionState;
  error: string | null;
}

type Action =
  | { type: "reset" }
  | { type: "event"; event: RunLiveEvent }
  | { type: "connection"; connection: ConnectionState }
  | { type: "error"; error: string | null };

const initialModel: Model = {
  state: initialRunLiveState,
  connection: "connecting",
  error: null,
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
  }
}

/** Follows a run live: its state, the state of the connection and the last error the server sent. */
export function useRunLive(runId: string): {
  state: RunLiveState;
  connection: ConnectionState;
  error: string | null;
} {
  const [model, dispatch] = useReducer(reducer, initialModel);

  useEffect(() => {
    dispatch({ type: "reset" });
    if (!runId) return;
    const client = new RunLiveClient({
      runId,
      url: defaultSocketUrl(window.location),
      onEvent: (event) => dispatch({ type: "event", event }),
      onConnection: (connection) => dispatch({ type: "connection", connection }),
      onError: (error) => dispatch({ type: "error", error }),
    });
    client.start();
    return () => client.close();
  }, [runId]);

  return { state: model.state, connection: model.connection, error: model.error };
}
