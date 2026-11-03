import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./app";
import { createApi } from "./lib/api";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Elemento #root não encontrado");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App api={createApi()} />
    </BrowserRouter>
  </StrictMode>,
);
