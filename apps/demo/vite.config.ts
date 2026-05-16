import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      "@oculus/sdk": fileURLToPath(new URL("../../packages/sdk/src/index.ts", import.meta.url)),
      "@oculus/svelte": fileURLToPath(new URL("../../packages/svelte/src/index.ts", import.meta.url))
    }
  },
  server: {
    port: 5173
  },
  preview: {
    port: 4173
  }
});
