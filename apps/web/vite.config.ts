import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // The dev proxy points at the local server; NEURONS_API_TARGET overrides it (loadEnv, not process.env).
  const env = loadEnv(mode, import.meta.dirname, "NEURONS_");
  const apiTarget = env["NEURONS_API_TARGET"] ?? "http://127.0.0.1:3100";
  const translateOrigin = (
    proxyReq: { setHeader: (name: string, value: string) => void },
    request: { headers: { origin?: string } },
  ) => {
    if (["http://127.0.0.1:5173", "http://localhost:5173"].includes(request.headers.origin ?? ""))
      proxyReq.setHeader("origin", new URL(apiTarget).origin);
  };
  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    server: {
      host: "127.0.0.1",
      port: 5173,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on("proxyReq", translateOrigin);
          },
          rewrite: (p) => p.replace(/^\/api/, ""),
        },
        // Live run events (T14a): the page opens a WebSocket on its own origin.
        "/ws": {
          target: apiTarget,
          changeOrigin: true,
          ws: true,
          configure: (proxy) => {
            proxy.on("proxyReqWs", translateOrigin);
          },
        },
      },
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
      css: false,
      // React Flow is heavy in jsdom: under a loaded machine (a full turbo run, a CI runner) the
      // editor and inspector suites take several times longer than the 5 s default. Only a ceiling:
      // a test ends as soon as it is done.
      testTimeout: 30_000,
      hookTimeout: 30_000,
    },
  };
});
