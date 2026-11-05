import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./app";
import { createApi } from "./lib/api";
import { SessionGate } from "./auth/session-gate";
import { DesktopFrame } from "./components/desktop-frame";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Elemento #root não encontrado");
const api = createApi();

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <DesktopFrame>
        <SessionGate api={api}>
          <App api={api} />
        </SessionGate>
      </DesktopFrame>
    </BrowserRouter>
  </StrictMode>,
);
