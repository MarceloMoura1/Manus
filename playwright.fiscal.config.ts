import { defineConfig, devices } from "@playwright/test";
const physical = process.env.RUN_DATABASE_INTEGRATION === "1",
  port = physical ? 3327 : 43128,
  baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: "./e2e",
  testMatch: physical ? "erp-fiscal-mysql.spec.ts" : "erp-fiscal.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    screenshot: "off",
    video: "off",
    trace: "off",
  },
  webServer: physical
    ? undefined
    : {
        command: `pnpm exec vite --host 127.0.0.1 --port ${port}`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 60_000,
        env: { ...process.env, NODE_ENV: "test" },
      },
});
