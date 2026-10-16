// Real-page identity/draft-key ownership scenarios for the state-lib NewIssuePage.
// Usage: VITE_STATE_BACKEND=state-lib vite --host 127.0.0.1 --port 6954, then
//   node tests/state-issue-identity-browser.mjs http://127.0.0.1:6954
// Only requests to the fixture's own origin whose path starts with /api/ are intercepted; Vite
// module URLs (for example /src/shared/api/client.ts) are never matched. Responses are deferred
// and resolved by the scenario itself, so no scenario waits on a timer.
import assert from 'node:assert/strict';
import { chromium, expect, webkit } from '@playwright/test';

const origin = process.argv[2] ?? 'http://127.0.0.1:6954';
assert.equal(new URL(origin).hostname, '127.0.0.1', 'Synthetic fixture is local only');
const WORKSPACE = 'synthetic-workspace';
const draftKey = (user) =>
  ['ticket-new', WORKSPACE, user, 'issue', '', '', '', '', '', '', '']
    .map(encodeURIComponent)
    .join(':');
const KEY = { first: draftKey('first'), second: draftKey('second') };
const json = (status, body) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});
const envelope = (code, message) => ({ error: { code, message } });

function isFixtureApi(url) {
  return url.origin === origin && url.pathname.startsWith('/api/');
}

function mockApi(page) {
  const pending = [];
  const unexpected = [];
  void page.route(isFixtureApi, (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice('/api'.length);
    const entry = {
      method: request.method(),
      path,
      key: request.headers()['idempotency-key'],
      body: request.postData(),
      route,
    };
    if (entry.method === 'POST' && path === '/v1/issues') pending.push(entry);
    else if (entry.method === 'GET' && path === '/v1/me') pending.push(entry);
    else if (entry.method === 'GET') void route.fulfill(json(200, []));
    else {
      unexpected.push(entry.method + ' ' + path);
      void route.fulfill(json(500, envelope('UNEXPECTED', 'unexpected request')));
    }
  });
  return {
    unexpected,
    pending,
    async next(method, path) {
      await expect
        .poll(() => pending.some((entry) => entry.method === method && entry.path === path))
        .toBe(true);
      return pending.splice(
        pending.findIndex((entry) => entry.method === method && entry.path === path),
        1,
      )[0];
    },
    respond: (entry, status, body) => entry.route.fulfill(json(status, body)),
  };
}

const storage = (page) => page.evaluate(() => Object.fromEntries(Object.entries(sessionStorage)));
const stored = async (page, key) => (await storage(page))[key];
const parsed = async (page, key) => JSON.parse((await stored(page, key)) ?? 'null');
const createdCount = (page) => page.evaluate(() => Number(window.createdCount));

async function open(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const api = mockApi(page);
  await page.goto(origin + '/tests/fixtures/issue-draft-lifecycle/index.html');
  const ui = {
    page,
    api,
    errors,
    title: page.getByRole('textbox', { name: 'Title', exact: true }),
    create: page.getByRole('button', { name: 'Create issue', exact: true }),
    retry: page.getByRole('button', { name: 'Retry creation', exact: true }),
    busy: page.locator('section[aria-label="New issue"][aria-busy="true"]'),
    location: page.locator('#location'),
    as: (account) => page.locator('#' + account).click(),
  };
  await expect(ui.title).toBeVisible();
  return { ui, close: () => context.close() };
}

const scenarios = {
  async 'control: a create that completes while mounted navigates and clears its draft'({ ui }) {
    await ui.title.fill('Mounted success');
    await ui.create.click();
    const request = await ui.api.next('POST', '/v1/issues');
    ui.api.respond(request, 201, { id: 'issue-1' });
    await expect(ui.location).toHaveText('/issues/issue-1');
    await expect.poll(() => stored(ui.page, KEY.first)).toBeUndefined();
  },

  async '(a) same-route account change A, B, A keeps each saved draft and no controller'({ ui }) {
    await ui.title.fill('First private draft');
    const savedA = await stored(ui.page, KEY.first);
    assert.ok(savedA?.includes('First private draft'));
    await ui.as('second');
    await expect(ui.title).toHaveValue('');
    await ui.title.fill('Second private draft');
    assert.equal(await stored(ui.page, KEY.first), savedA, 'typing as B must not write to A');
    const savedB = await stored(ui.page, KEY.second);
    assert.ok(savedB?.includes('Second private draft'));
    await ui.as('first');
    await expect(ui.title).toHaveValue('First private draft');
    await ui.title.fill('First edited');
    assert.equal(await stored(ui.page, KEY.second), savedB, 'typing as A must not write to B');
    await ui.as('second');
    await expect(ui.title).toHaveValue('Second private draft');
  },

  async '(b) identity temporarily unavailable hides private text, writes nothing anonymous'({
    ui,
  }) {
    await ui.title.fill('A before the gap');
    const before = await storage(ui.page);
    await ui.page.locator('#waiting').click();
    await expect(ui.title).toHaveCount(0);
    await expect(ui.busy).toBeAttached();
    assert.equal(await ui.page.getByText('A before the gap').count(), 0);
    const during = await storage(ui.page);
    assert.deepEqual(during, before, 'the gap must not create or change any stored draft');
    assert.deepEqual(
      Object.keys(during).filter((key) => key.startsWith('ticket-new::')),
      [],
      'nothing may be stored under the anonymous empty-id key',
    );
    // The removed query refetches /api/v1/me; the account returns only when the test says so.
    const me = await ui.api.next('GET', '/v1/me');
    ui.api.respond(me, 200, {
      id: 'first',
      workspace_id: WORKSPACE,
      name: 'first',
      email: 'first@example.invalid',
      role: 'owner',
      scopes: [],
      auth_type: 'session',
    });
    await expect(ui.title).toHaveValue('A before the gap');
    assert.deepEqual(await storage(ui.page), before);
  },

  async '(b2) after an unavailable gap a different account does not inherit the private text'({
    ui,
  }) {
    await ui.title.fill('A before the gap');
    const savedA = await stored(ui.page, KEY.first);
    await ui.page.locator('#waiting').click();
    await expect(ui.title).toHaveCount(0);
    const me = await ui.api.next('GET', '/v1/me');
    ui.api.respond(me, 200, {
      id: 'second',
      workspace_id: WORKSPACE,
      name: 'second',
      email: 'second@example.invalid',
      role: 'owner',
      scopes: [],
      auth_type: 'session',
    });
    await expect(ui.title).toBeVisible();
    await expect(ui.title).toHaveValue('');
    assert.equal(await stored(ui.page, KEY.first), savedA);
    assert.equal(await stored(ui.page, KEY.second), undefined);
  },

  async '(c) unmount and remount restores the saved draft of the same account'({ ui }) {
    await ui.title.fill('Survives remount');
    await ui.page.locator('#toggle').click();
    await expect(ui.title).toHaveCount(0);
    await ui.page.locator('#toggle').click();
    await expect(ui.title).toHaveValue('Survives remount');
    await ui.as('second');
    await expect(ui.title).toHaveValue('');
  },

  async '(d) permanent rejection after an account switch releases only the exact record'({ ui }) {
    await ui.title.fill('A text');
    await ui.create.click();
    const request = await ui.api.next('POST', '/v1/issues');
    await expect
      .poll(async () => (await parsed(ui.page, KEY.first))?.attempt?.key)
      .toBe(request.key);
    await ui.as('second');
    await expect(ui.title).toHaveValue('');
    await ui.title.fill('B text');
    const savedB = await stored(ui.page, KEY.second);
    ui.api.respond(request, 422, envelope('INVALID', 'Rejected by server'));
    await expect.poll(async () => (await parsed(ui.page, KEY.first))?.attempt).toBeUndefined();
    assert.equal((await parsed(ui.page, KEY.first)).title, 'A text', 'A text is kept');
    assert.equal(await stored(ui.page, KEY.second), savedB, "B's draft is untouched");
    await expect(ui.title).toHaveValue('B text');
    await expect(ui.page.getByText('Rejected by server')).toHaveCount(0);
    await expect(ui.location).toHaveText('/issues/new');
    await ui.as('first');
    await expect(ui.title).toHaveValue('A text');
    await expect(ui.title).toBeEditable();
    await expect(ui.create).toBeVisible();
    await expect(ui.retry).toHaveCount(0);
  },

  async '(e) late success after a switch removes only its own record and does not navigate'({
    ui,
  }) {
    await ui.title.fill('A sent text');
    await ui.create.click();
    const request = await ui.api.next('POST', '/v1/issues');
    await expect
      .poll(async () => (await parsed(ui.page, KEY.first))?.attempt?.key)
      .toBe(request.key);
    await ui.as('second');
    await ui.title.fill('B text');
    const savedB = await stored(ui.page, KEY.second);
    const handled = await createdCount(ui.page);
    ui.api.respond(request, 201, { id: 'issue-late' });
    await expect.poll(() => createdCount(ui.page)).toBeGreaterThan(handled);
    assert.equal(await stored(ui.page, KEY.first), undefined, 'the exact sent record is settled');
    assert.equal(await stored(ui.page, KEY.second), savedB, "B's draft is untouched");
    await expect(ui.title).toHaveValue('B text');
    await expect(ui.location).toHaveText('/issues/new');
  },

  async '(e2) late success does not remove a newer draft saved under the same key'({ ui }) {
    await ui.title.fill('A sent text');
    await ui.create.click();
    const request = await ui.api.next('POST', '/v1/issues');
    await expect
      .poll(async () => (await parsed(ui.page, KEY.first))?.attempt?.key)
      .toBe(request.key);
    await ui.as('second');
    await expect(ui.title).toHaveValue('');
    const sent = await parsed(ui.page, KEY.first);
    const newer = JSON.stringify({ ...sent, title: 'Newer A draft', attempt: undefined });
    await ui.page.evaluate(
      ([key, value]) => sessionStorage.setItem(key, value),
      [KEY.first, newer],
    );
    const handled = await createdCount(ui.page);
    ui.api.respond(request, 201, { id: 'issue-late' });
    await expect.poll(() => createdCount(ui.page)).toBeGreaterThan(handled);
    assert.equal(await stored(ui.page, KEY.first), newer);
    await expect(ui.location).toHaveText('/issues/new');
    await ui.as('first');
    await expect(ui.title).toHaveValue('Newer A draft');
  },

  async '(f) same-id identity refetch keeps focus, text and caret; a real change remounts'({ ui }) {
    await ui.title.fill('abcdefghij');
    await ui.title.evaluate((element) => {
      element.dataset.probe = 'same-element';
      element.focus();
      element.setSelectionRange(3, 7);
    });
    // dispatchEvent keeps focus in the textbox; a real click would move it to the button.
    await ui.page.locator('#same-ids').dispatchEvent('click');
    await ui.page.locator('#same-ids').dispatchEvent('click');
    const state = () =>
      ui.page.evaluate(() => {
        const active = document.activeElement;
        return {
          probe: active instanceof HTMLElement ? active.dataset.probe : undefined,
          value: active instanceof HTMLTextAreaElement ? active.value : undefined,
          start: active instanceof HTMLTextAreaElement ? active.selectionStart : undefined,
          end: active instanceof HTMLTextAreaElement ? active.selectionEnd : undefined,
        };
      });
    await expect
      .poll(state)
      .toEqual({ probe: 'same-element', value: 'abcdefghij', start: 3, end: 7 });
    await ui.title.pressSequentially('X');
    await expect(ui.title).toHaveValue('abcXhij');
    await ui.as('second');
    await expect(ui.title).toHaveValue('');
    await expect(ui.title).not.toHaveAttribute('data-probe', 'same-element');
  },

  async '(g) retry reuses the idempotency key for the same account, also across a switch'({ ui }) {
    await ui.title.fill('Retry me');
    await ui.create.click();
    const first = await ui.api.next('POST', '/v1/issues');
    assert.ok(first.key);
    ui.api.respond(first, 503, envelope('UNAVAILABLE', 'Service unavailable'));
    await expect(ui.retry).toBeVisible();
    await ui.as('second');
    await expect(ui.title).toHaveValue('');
    await ui.as('first');
    await expect(ui.retry).toBeVisible();
    await ui.retry.click();
    const second = await ui.api.next('POST', '/v1/issues');
    assert.equal(second.key, first.key);
    assert.equal(second.body, first.body);
    ui.api.respond(second, 201, { id: 'issue-retried' });
    await expect(ui.location).toHaveText('/issues/issue-retried');
  },
};

const failures = [];
const unavailable = [];
const wanted = (process.argv[3] ?? 'chromium,webkit').split(',');
let executed = 0;
for (const [engineName, engine] of Object.entries({ chromium, webkit }).filter(([engineName]) =>
  wanted.includes(engineName),
)) {
  let browser;
  try {
    browser = await engine.launch();
  } catch (error) {
    // A browser that cannot start is reported, never counted as a pass.
    unavailable.push(engineName);
    console.log('UNAVAILABLE', engineName, '::', String(error.message).split('\n')[0]);
    continue;
  }
  executed += Object.keys(scenarios).length;
  try {
    for (const [name, run] of Object.entries(scenarios)) {
      const session = await open(browser);
      try {
        await run(session);
        assert.deepEqual(session.ui.api.unexpected, [], 'no unexpected API traffic');
        assert.deepEqual(session.ui.errors, [], 'no page errors');
        console.log('PASS', engineName, name);
      } catch (error) {
        failures.push(engineName + ' ' + name);
        console.log(
          'FAIL',
          engineName,
          name,
          '::',
          String(error.message).split('\n').slice(0, 4).join(' | ').slice(0, 400),
        );
      } finally {
        await session.ui.page.unrouteAll({ behavior: 'ignoreErrors' });
        await session.close();
      }
    }
  } finally {
    await browser.close();
  }
}
console.log(
  `RESULT ${executed - failures.length} passed, ${failures.length} failed of ${executed} executed`,
  unavailable.length ? `; engines unavailable: ${unavailable.join(',')}` : '',
);
process.exit(failures.length ? 1 : unavailable.length ? 2 : 0);
