import { defineConfig, loadEnv } from "vite";

/** Development opens the web app; a combined production server serves the editor at /new. */
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, import.meta.dirname, "NEURONS_");
  const url =
    env["NEURONS_MODELER_URL"] ?? (command === "serve" ? "http://127.0.0.1:5173/new" : "/new");
  if (!(url.startsWith("/") && !url.startsWith("//")) && !/^https?:\/\//.test(url))
    throw new Error(
      "NEURONS_MODELER_URL deve ser um endereço HTTP(S) ou caminho absoluto no site.",
    );
  const escaped = url
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return {
    server: { host: "127.0.0.1", port: 5191 },
    plugins: [
      {
        name: "modeler-entry",
        transformIndexHtml: (html: string) => html.replaceAll("__MODELER_URL__", escaped),
      },
    ],
  };
});
