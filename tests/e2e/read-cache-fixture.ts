import { expect, type Browser, type Cookie, type Page, type Route } from '@playwright/test';
// Separate synthetic members keep each account far below the 12-per-15-minute login limit.
export const JAMIE = 'jamie.chen@example.test',
  TAYLOR = 'taylor.park@example.test',
  CASEY = 'casey.brooks@example.test',
  SAM = 'sam.rivera@example.test';
export const sessions = new Map<string, Cookie[]>();
/** Signs in on /tasks and waits until the confirmed first screen is saved (writes wait 400 ms). */
export async function signIn(page: Page, email: string) {
  await openTasks(page, email);
  await expect
    .poll(async () => (await savedCopy(page)).keys)
    .toEqual(expect.arrayContaining(['["me"]', '["catalog"]', '["issues",{}]']));
}
async function openTasks(page: Page, email: string) {
  const saved = sessions.get(email);
  if (saved) {
    await page.context().addCookies(saved);
    if ((await page.request.get('/api/v1/me')).ok()) {
      await page.goto('/tasks');
      await expect(page.getByTestId('issue-row').first()).toBeVisible();
      return;
    }
    sessions.delete(email);
    await page.context().clearCookies();
  }
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('local-demo-password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByTestId('issue-row').first()).toBeVisible();
  sessions.set(email, await page.context().cookies());
}
/** A session of `email` created in another browser window, as a second sign-in would. */
export async function sessionElsewhere(browser: Browser, email: string) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    await signIn(await context.newPage(), email);
    return await context.cookies();
  } finally {
    await context.close();
  }
}
/** Booleans and query keys only: saved content never leaves the page (AGENT-SESSION-SAFETY). */
export function savedCopy(page: Page, needles: string[] = []) {
  return page.evaluate(async (needles) => {
    const empty = {
      entries: 0,
      accounts: 0,
      keys: [] as string[],
      found: needles.map(() => false),
      owners: needles.map(() => false),
    };
    const names = await indexedDB.databases();
    if (!names.some((database) => database.name === 'tasks-read-cache')) return empty;
    const opened = Promise.withResolvers<IDBDatabase>();
    const request = indexedDB.open('tasks-read-cache');
    request.onsuccess = () => opened.resolve(request.result);
    request.onerror = () => opened.reject(request.error);
    const db = await opened.promise;
    try {
      if (!db.objectStoreNames.contains('entries')) return empty;
      const read = Promise.withResolvers<{ partition: string; hash: string; json: string }[]>();
      const all = db.transaction('entries').objectStore('entries').getAll();
      all.onsuccess = () => read.resolve(all.result);
      all.onerror = () => read.reject(all.error);
      const rows = await read.promise;
      return {
        entries: rows.length,
        accounts: new Set(rows.map((row) => row.partition)).size,
        keys: rows.map((row) => row.hash),
        found: needles.map((needle) => rows.some((row) => row.json.includes(needle))),
        owners: needles.map((needle) => rows.some((row) => row.partition.includes(needle))),
      };
    } finally {
      db.close();
    }
  }, needles);
}
/** Holds matching API requests until released, so only the saved copy can render. */
export async function holdApi(page: Page, match = (url: URL) => url.pathname.startsWith('/api/')) {
  const held: Route[] = [];
  let open = false;
  const handler = (route: Route) => (open ? route.continue() : void held.push(route));
  await page.route(match, handler);
  return {
    async release() {
      open = true;
      await page.unroute(match, handler);
      for (const route of held.splice(0)) await route.continue().catch(() => undefined);
    },
  };
}
export const draftKeys = (page: Page, prefix: string) =>
  page.evaluate(
    (prefix) => Object.keys(sessionStorage).filter((key) => key.startsWith(prefix)).length,
    prefix,
  );
export async function firstTasks(page: Page, count: number) {
  const body = await (await page.request.get('/api/v1/issues?limit=' + count)).json();
  return body.data as { id: string; key: string; title: string }[];
}
