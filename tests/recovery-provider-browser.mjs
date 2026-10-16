import assert from 'node:assert/strict';
import { chromium, webkit, expect } from '@playwright/test';
const origin = process.argv[2] ?? 'http://127.0.0.1:6974';
assert.equal(new URL(origin).hostname, '127.0.0.1');
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage(),
      errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin + '/tests/fixtures/recovery-provider/index.html');
    await page.waitForFunction(
      () => window.recoveryAudit?.current && window.recoveryAudit.connects >= 2,
    );
    assert.equal(
      await page.evaluate(() => window.recoveryAudit.subscriptions),
      1,
      'StrictMode replay leaves exactly one live subscription',
    );
    await page.getByLabel('Draft text', { exact: true }).fill('Survives StrictMode and unmount');
    await expect(page.locator('#draft-value')).toHaveText('Survives StrictMode and unmount');
    await page.locator('#toggle').click();
    await page.waitForFunction(
      () => !document.querySelector('#reader') && window.recoveryAudit.subscriptions === 0,
    );
    const preserved = await page.evaluate(() => {
      const a = window.recoveryAudit;
      const before = a.session.getItem(a.key);
      a.retained[0].setItem(a.key, 'stale write');
      return before === a.session.getItem(a.key);
    });
    assert(preserved, 'Disposed owner cannot overwrite the durable draft');
    await page.locator('#toggle').click();
    await page.waitForFunction(
      () => window.recoveryAudit.retained.length === 2 && window.recoveryAudit.subscriptions === 1,
    );
    await expect(page.getByLabel('Draft text', { exact: true })).toHaveValue(
      'Survives StrictMode and unmount',
    );
    await page.getByLabel('Draft text', { exact: true }).fill('New live owner');
    await expect(page.locator('#draft-value')).toHaveText('New live owner');
    const independent = await page.evaluate(() => {
      const a = window.recoveryAudit;
      return a.retained[0] !== a.retained[1] && a.retained[0].getItem(a.key) === null;
    });
    assert(independent);
    assert.deepEqual(errors, []);
    console.log(
      'PASS',
      name,
      'real StrictMode effect replay, live storage, final cleanup, durable recovery and stale owner isolation',
    );
  } finally {
    await browser.close();
  }
}
