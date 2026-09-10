import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? 'off' : 'retain-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
    timezoneId: 'UTC',
    locale: 'en-US',
  },
  webServer: {
    command: 'bun scripts/test-server.mjs',
    url: 'http://localhost:5173',
    reuseExistingServer: false,
    timeout: 60000,
  },
  expect: { toHaveScreenshot: { animations: 'disabled', maxDiffPixelRatio: 0.003 } },
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}{ext}',
  projects: [
    { name: 'chromium', testIgnore: /visual\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'visual',
      testMatch: /visual\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
  ],
});
