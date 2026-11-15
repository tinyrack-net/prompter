import { defineConfig, devices } from '@playwright/test';

const APP_PORT = 4319;
const OUTLINE_PORT = 4320;

export const FAKE_OUTLINE = `http://localhost:${OUTLINE_PORT}`;

export default defineConfig({
  testDir: './e2e',
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    locale: 'en-US',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node --import tsx e2e/fake-outline.ts',
      url: `${FAKE_OUTLINE}/__test/health`,
      reuseExistingServer: false,
      env: {
        FAKE_OUTLINE_PORT: String(OUTLINE_PORT),
        FAKE_OUTLINE_WEBHOOK_URL: `http://localhost:${APP_PORT}/api/webhooks/outline`,
      },
    },
    {
      // The production build, as it runs in the container.
      command: 'node dist/server/main.js',
      url: `http://localhost:${APP_PORT}/healthz`,
      reuseExistingServer: false,
      env: {
        PORT: String(APP_PORT),
        NODE_ENV: 'production',
        OUTLINE_URL: FAKE_OUTLINE,
        OUTLINE_API_KEY: 'test-api-key',
        OUTLINE_WEBHOOK_SECRET: 'test-webhook-secret',
        LOG_LEVEL: 'warn',
      },
    },
  ],
});
