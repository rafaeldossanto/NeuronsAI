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
  const base = env["NEURONS_SITE_BASE"] ?? "./";
  if (base !== "./" && !/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base))
    throw new Error("NEURONS_SITE_BASE deve ser ./, / ou uma subpasta como /NeuronsAI/.");
  const siteUrl = env["NEURONS_SITE_URL"];
  if (siteUrl && !/^https?:\/\//.test(siteUrl))
    throw new Error("NEURONS_SITE_URL deve ser um endereço HTTP(S).");
  const socialImage = siteUrl
    ? new URL("icon.png", siteUrl.endsWith("/") ? siteUrl : siteUrl + "/").href
    : `${base}icon.png`;
  return {
    base,
    server: { host: "127.0.0.1", port: 5191 },
    plugins: [
      {
        name: "modeler-entry",
        transformIndexHtml: (html: string) =>
          html
            .replaceAll("__MODELER_URL__", escaped)
            .replaceAll(
              "__SITE_IMAGE__",
              socialImage.replaceAll("&", "&amp;").replaceAll('"', "&quot;"),
            ),
      },
    ],
  };
});
