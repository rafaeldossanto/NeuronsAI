import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./app";
import { createApi } from "./lib/api";
import { SessionGate } from "./auth/session-gate";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Elemento #root não encontrado");
const api = createApi();

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <SessionGate api={api}>
        <App api={api} />
      </SessionGate>
    </BrowserRouter>
  </StrictMode>,
);
