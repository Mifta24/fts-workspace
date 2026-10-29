import { defineConfig, devices } from "@playwright/test";
import {
  E2E_BASE_URL,
  E2E_DATABASE_URL,
  E2E_PORT,
  GATEWAY_PORT,
  GATEWAY_SECRET,
} from "./e2e/e2e-env";

export default defineConfig({
  testDir: "e2e",
  // Tests share one seeded database and run in order.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: E2E_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // `next dev` because the production server rejects EMAIL_TRANSPORT=log by design.
      command: `pnpm exec next dev --port ${E2E_PORT}`,
      // Not /api/health: the database is only started afterwards, in globalSetup.
      url: `${E2E_BASE_URL}/en/sign-in`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        NEXT_DIST_DIR: ".next-e2e",
        DATABASE_URL: E2E_DATABASE_URL,
        BETTER_AUTH_SECRET: "e2e-only-secret-0123456789abcdefghijklmnopqrstu",
        BETTER_AUTH_URL: E2E_BASE_URL,
        EMAIL_TRANSPORT: "log",
        LOG_LEVEL: "warn",
        // The app publishes to the gateway; browsers connect to it by the same host name as the
        // app ("localhost") so the session cookie is sent with the WebSocket handshake.
        REALTIME_URL: `http://127.0.0.1:${GATEWAY_PORT}`,
        REALTIME_PUBLIC_URL: `http://localhost:${GATEWAY_PORT}`,
        REALTIME_PUBLISH_SECRET: GATEWAY_SECRET,
      },
    },
    {
      command: "pnpm gateway",
      url: `http://127.0.0.1:${GATEWAY_PORT}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        DATABASE_URL: E2E_DATABASE_URL,
        APP_URL: E2E_BASE_URL,
        ALLOWED_ORIGIN: E2E_BASE_URL,
        GATEWAY_PORT: String(GATEWAY_PORT),
        GATEWAY_HOST: "127.0.0.1",
        REALTIME_PUBLISH_SECRET: GATEWAY_SECRET,
      },
    },
  ],
});
