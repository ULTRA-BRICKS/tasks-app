import assert from 'node:assert/strict';
import { chromium, webkit } from '@playwright/test';
const origin = process.argv[2] ?? 'http://127.0.0.1:6931';
assert.equal(new URL(origin).hostname, '127.0.0.1', 'Synthetic lifecycle fixture is local only');
for (const [name, engine] of [
  ['chromium', chromium],
  ['webkit', webkit],
]) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage(),
      errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin + '/tests/fixtures/state-hooks/index.html');
    await page.waitForSelector('#selected');
    assert.equal(await page.locator('#selected').innerText(), 'Alpha');
    await page.locator('#field').click();
    assert.equal(await page.locator('#selected').innerText(), 'Beta');
    await page.locator('#source').click();
    assert.equal(await page.locator('#selected').innerText(), 'Delta');
    await page.locator('#old-source').click();
    assert.equal(await page.locator('#selected').innerText(), 'Delta');
    await page.locator('#new-source').click();
    assert.equal(await page.locator('#selected').innerText(), 'new-b');
    await page.locator('#increase').click();
    assert.equal(await page.locator('#count').innerText(), '2');
    await page.getByLabel('Draft').fill('Kept while rendering');
    await page.locator('#inspect').click();
    assert((await page.locator('#owners').innerText()).includes('Kept while rendering'));
    await page.locator('#toggle').click();
    await page.locator('#late').click();
    await page.locator('#inspect').click();
    assert.equal(await page.locator('#owners').innerText(), '{}');
    await page.locator('#toggle').click();
    assert.equal(await page.getByLabel('Draft').inputValue(), 'Draft');
    assert.deepEqual(errors, []);
    console.log(
      'PASS',
      name,
      'selector/source changes, StrictMode updates, stale setter isolation and remount',
    );
  } finally {
    await browser.close();
  }
}
