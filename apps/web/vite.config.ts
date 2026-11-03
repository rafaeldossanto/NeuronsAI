import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // The dev proxy points at the local server; NEURONS_API_TARGET overrides it (loadEnv, not process.env).
  const env = loadEnv(mode, import.meta.dirname, "NEURONS_");
  const apiTarget = env["NEURONS_API_TARGET"] ?? "http://127.0.0.1:3100";
  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    server: {
      host: "127.0.0.1",
      port: 5173,
      proxy: {
        "/api": { target: apiTarget, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, "") },
      },
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
      css: false,
    },
  };
});
