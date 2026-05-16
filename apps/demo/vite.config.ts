import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@oculus/sdk": fileURLToPath(new URL("../../packages/sdk/src/index.ts", import.meta.url)),
      "@oculus/react": fileURLToPath(new URL("../../packages/react/src/index.ts", import.meta.url))
    }
  },
  server: {
    port: 5173
  },
  preview: {
    port: 4173
  }
});
