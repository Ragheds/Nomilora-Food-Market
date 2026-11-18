import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: { "@": fileURLToPath(new URL("../nomilora/src", import.meta.url)) },
    dedupe: ["react", "react-dom"],
  },
  test: {
    environment: "jsdom",
    include: ["tests/*.ui.test.tsx"],
    testTimeout: 15000,
    hookTimeout: 15000,
    environmentOptions: { jsdom: { url: "http://localhost:5173/" } },
    server: { deps: { external: ["@electric-sql/pglite"] } },
  },
});
