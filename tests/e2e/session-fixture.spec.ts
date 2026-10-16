/** Exercises login diagnostics through the real page and intercepted HTTP failures. */
import { test as base, expect } from '@playwright/test';
import { login } from './session-fixture';

// A distinct worker fixture prevents another spec's cached successful login from skipping the form.
const test = base.extend<{}, { loginDiagnostics: boolean }>({
  loginDiagnostics: [true, { scope: 'worker', auto: true }],
});

for (const [status, code] of [
  [401, 'INVALID_CREDENTIALS'],
  [429, 'RATE_LIMITED'],
] as const) {
  test(`login reports HTTP ${status} and its server error`, async ({ page }, info) => {
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({ status, json: { error: { code, message: 'Synthetic login rejection' } } }),
    );
    await expect(login(page)).rejects.toThrow(new RegExp(`HTTP ${status}.*${code}`));
    await expect(page.getByText('Synthetic login rejection')).toBeVisible();
    await page.screenshot({ path: info.outputPath('rejected-login.png') });
  });
}
