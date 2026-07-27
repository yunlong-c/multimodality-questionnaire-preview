import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pagesBase =
  process.env.MMQ_GITHUB_PAGES_BASE?.trim() || "/";
const frontendRoot = fileURLToPath(new URL(".", import.meta.url));

export function shouldExcludeAdminPage(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.MMQ_EXCLUDE_ADMIN === "true" || env.NETLIFY === "true";
}

export function createHtmlInputs(
  excludeAdminPage: boolean
): Record<string, string> {
  const inputs: Record<string, string> = {
    questionnaire: resolve(frontendRoot, "index.html"),
  };

  if (!excludeAdminPage) {
    inputs.admin = resolve(frontendRoot, "admin.html");
  }

  return inputs;
}

export default defineConfig({
  base: pagesBase,
  publicDir:
    process.env.MMQ_EXTERNAL_ASSETS === "true"
      ? false
      : "public",
  build: {
    rollupOptions: {
      input: createHtmlInputs(shouldExcludeAdminPage()),
      output: {
        manualChunks(id) {
          if (
            id.includes("/node_modules/jspsych/") ||
            id.includes("/node_modules/@jspsych/")
          ) {
            return "jspsych-vendor";
          }
          if (id.includes("sequenceCatalog.generated")) {
            return "stimulus-catalog";
          }
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.MMQ_API_TARGET ?? "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
