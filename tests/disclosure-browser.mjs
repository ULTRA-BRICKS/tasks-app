// Real-browser checks for the shared Disclosure (native <details>).
// Usage (one backend per server):
//   VITE_STATE_BACKEND=state-lib bun --bun vite --host 127.0.0.1 --port 6956 --strictPort
//   node tests/disclosure-browser.mjs http://127.0.0.1:6956 chromium,webkit state-lib
//   (and the same with VITE_STATE_BACKEND=baseline ... baseline)
// state-lib additionally asserts that the open flag is a registered owner and that a state
// write opens the element exactly once (no toggle echo loop).
import assert from 'node:assert/strict';
import { chromium, webkit } from '@playwright/test';

const origin = process.argv[2] ?? 'http://127.0.0.1:6956';
const engines = (process.argv[3] ?? 'chromium,webkit').split(',');
const backend = process.argv[4] ?? 'state-lib';
assert.equal(new URL(origin).hostname, '127.0.0.1', 'Synthetic fixture is local only');
const launchers = { chromium, webkit };

for (const name of engines) {
  const browser = await launchers[name].launch();
  try {
    const page = await browser.newPage(),
      errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin + '/tests/fixtures/disclosure/index.html');
    const details = page.locator('details'),
      summary = page.locator('summary');
    await summary.waitFor();
    await page.evaluate(() => {
      window.toggles = 0;
      document.querySelector('details').addEventListener('toggle', () => window.toggles++);
    });
    const isOpen = () => details.evaluate((el) => el.open);
    const toggles = () => page.evaluate(() => window.toggles);
    const focusedIsSummary = () =>
      page.evaluate(() => document.activeElement?.tagName === 'SUMMARY');
    const owners = () => page.evaluate(() => JSON.stringify(window.registry.inspect()));

    assert.equal(await isOpen(), false, name + ': initially closed');
    if (backend === 'state-lib')
      assert.deepEqual(
        Object.values(JSON.parse(await owners())),
        [false],
        name + ': one owner, closed',
      );

    await summary.click();
    await page.waitForFunction(() => window.toggles === 1);
    assert.equal(await isOpen(), true, name + ': click opens');
    assert.equal(await focusedIsSummary(), true, name + ': focus stays on summary after click');
    if (backend === 'state-lib')
      assert.deepEqual(
        Object.values(JSON.parse(await owners())),
        [true],
        name + ': owner follows toggle',
      );

    await page.locator('#inside').fill('kept text');
    await page.locator('#rerender').click();
    await page.locator('#rerender', { hasText: 'Re-render 1' }).waitFor();
    assert.equal(await isOpen(), true, name + ': open survives re-render');
    assert.equal(await page.locator('#inside').inputValue(), 'kept text');
    assert.equal(await toggles(), 1, name + ': re-render emits no toggle');

    await summary.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.toggles === 2);
    assert.equal(await isOpen(), false, name + ': Enter closes');
    assert.equal(await focusedIsSummary(), true, name + ': focus stays on summary after Enter');
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.toggles === 3);
    assert.equal(await isOpen(), true, name + ': Space opens');
    assert.equal(await focusedIsSummary(), true, name + ': focus stays on summary after Space');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.toggles === 4);
    await page.locator('#rerender').click();
    await page.locator('#rerender', { hasText: 'Re-render 2' }).waitFor();
    assert.equal(await isOpen(), false, name + ': closed state survives re-render');

    if (backend === 'state-lib') {
      // State -> DOM: a write to the registered owner opens the element once; the toggle it
      // causes writes the same value back and stops there.
      await page.evaluate(() => {
        const [id] = Object.keys(window.registry.inspect());
        window.registry.value(id, false).set(true);
      });
      await page.waitForFunction(() => window.toggles === 5);
      assert.equal(await isOpen(), true, name + ': state write opens');
      await page.evaluate(() => new Promise((done) => setTimeout(done, 100)));
      assert.equal(await toggles(), 5, name + ': no echo loop');
      assert.deepEqual(Object.values(JSON.parse(await owners())), [true]);
    }
    await page.goto(origin + '/tests/fixtures/disclosure/index.html?open');
    await summary.waitFor();
    assert.equal(await isOpen(), true, name + ': defaultOpen is honoured in both builds');
    await summary.click();
    await page.waitForFunction(() => !document.querySelector('details').open);
    await page.locator('#rerender').click();
    await page.locator('#rerender', { hasText: 'Re-render 1' }).waitFor();
    assert.equal(
      await isOpen(),
      false,
      name + ': manually closed defaultOpen survives a parent render',
    );
    await page.goto(origin + '/tests/fixtures/disclosure/index.html?change-default');
    await summary.waitFor();
    assert.equal(await isOpen(), false);
    await page.locator('#rerender').click();
    await page.locator('#rerender', { hasText: 'Re-render 1' }).waitFor();
    assert.equal(
      await isOpen(),
      false,
      name + ': a changed default does not overwrite existing state',
    );
    assert.deepEqual(errors, []);
    console.log('PASS', name, backend, 'click, Enter/Space, focus, toggle sync, re-render');
  } finally {
    await browser.close();
  }
}
