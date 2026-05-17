import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 8_000
  },
  use: {
    baseURL: "http://127.0.0.1:5174",
    trace: "on-first-retry"
  },
  webServer: [
    {
      command: "PORT=3100 bun run server",
      url: "http://127.0.0.1:3100/health",
      reuseExistingServer: !process.env.CI,
      timeout: 20_000
    },
    {
      command: "VITE_OCULUS_SERVER_URL=http://127.0.0.1:3100 bun run demo -- --port 5174",
      url: "http://127.0.0.1:5174",
      reuseExistingServer: !process.env.CI,
      timeout: 20_000
    }
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
