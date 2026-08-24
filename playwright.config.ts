import { defineConfig, devices } from '@playwright/test';

const e2eBaseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const e2eWebServerCommand = process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ?? 'pnpm dev';

/**
 * Configuração do Playwright para testes E2E
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: e2eBaseUrl,
    trace: 'on-first-retry',
    screenshot: 'off',
    video: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],

  webServer: {
    command: e2eWebServerCommand,
    url: e2eBaseUrl,
    reuseExistingServer: !process.env.CI,
  },
});
