import { defineConfig, devices } from '@playwright/test';
import { resolveDevelopment } from './packages/config/development.mjs';
import base from './playwright.config';
const dev = resolveDevelopment(process.env);
// Real Service Worker + IndexedDB against the built application (`vite preview` proxying the
// synthetic API). Worker-blocked scenarios stay in the default config.
export default defineConfig({
  ...base,
  testMatch: /\.shell\.spec\.ts$/,
  webServer: {
    command: 'TASKS_E2E_WEB=preview bun scripts/test-server.mjs',
    url: dev.appUrl,
    reuseExistingServer: false,
    timeout: 60000,
  },
  projects: [{ name: 'shell-chromium', use: { ...devices['Desktop Chrome'] } }],
});
