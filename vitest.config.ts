import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts"]
  },
  resolve: {
    alias: {
      "@oculus/server": new URL("./packages/server/src/index.ts", import.meta.url).pathname,
      "@oculus/sdk": new URL("./packages/sdk/src/index.ts", import.meta.url).pathname,
      "@oculus/svelte": new URL("./packages/svelte/src/index.ts", import.meta.url).pathname
    }
  }
});
