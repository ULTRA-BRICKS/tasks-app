import { defineConfig, devices } from '@playwright/test';
import { resolveDevelopment } from './packages/config/development.mjs';
import base from './playwright.config';
const dev = resolveDevelopment(process.env);
// Real Service Worker + IndexedDB against the built application in Chromium and WebKit. The
// synthetic API runs here; each test worker serves `dist` with `vite preview` itself (see
// read-cache.shell.spec.ts). Worker-blocked scenarios stay in the default config.
export default defineConfig({
  ...base,
  testMatch: /\.shell\.spec\.ts$/,
  webServer: {
    command: 'TASKS_E2E_WEB=none bun scripts/test-server.mjs',
    url: dev.apiTarget + '/api/health',
    reuseExistingServer: false,
    timeout: 60000,
  },
  projects: [
    { name: 'shell-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'shell-webkit', use: { ...devices['Desktop Safari'], launchOptions: {} } },
  ],
});
