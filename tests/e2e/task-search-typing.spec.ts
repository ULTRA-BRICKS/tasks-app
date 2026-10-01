import { test, expect, type Page } from '@playwright/test';
import { login } from './session-fixture';
const urlQuery = (page: Page) => new URL(page.url()).searchParams.get('q');
const search = (page: Page) => page.getByRole('textbox', { name: 'Search tasks', exact: true });
async function openTasks(page: Page) {
  await login(page);
  await page.goto('/tasks');
  await expect(page.getByTestId('issue-row').first()).toBeVisible();
  await expect(search(page)).toHaveValue('');
}
test('typing with no delay keeps every character in the input and the URL', async ({ page }) => {
  await openTasks(page);
  const text = 'fast typing test';
  await search(page).click();
  await search(page).pressSequentially(text, { delay: 0 });
  await expect(search(page)).toHaveValue(text);
  await expect.poll(() => urlQuery(page)).toBe(text);
  await page.waitForTimeout(600);
  await expect(search(page)).toHaveValue(text);
  expect(urlQuery(page)).toBe(text);
});
test('30 characters at 10 ms intervals arrive intact without one history entry per keystroke', async ({
  page,
}) => {
  await openTasks(page);
  const text = 'abcdefghij klmnopqrst uvwxyz 0';
  expect(text).toHaveLength(30);
  const before = await page.evaluate(() => history.length);
  await search(page).click();
  await search(page).pressSequentially(text, { delay: 10 });
  await expect(search(page)).toHaveValue(text);
  await expect.poll(() => urlQuery(page)).toBe(text);
  await page.waitForTimeout(600);
  await expect(search(page)).toHaveValue(text);
  expect(await page.evaluate(() => history.length)).toBe(before);
});
test('a burst of input events inside one task loses nothing', async ({ page }) => {
  await openTasks(page);
  const text = 'mobile keyboard burst';
  await search(page).click();
  await search(page).evaluate((input: HTMLInputElement, value: string) => {
    const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    let typed = input.value;
    for (const character of value) {
      typed += character;
      nativeValue?.set?.call(input, typed);
      input.dispatchEvent(new InputEvent('input', { bubbles: true, data: character }));
    }
  }, text);
  await expect(search(page)).toHaveValue(text);
  await expect.poll(() => urlQuery(page)).toBe(text);
});
test('typing filters the list, replaces history and a reload restores the query', async ({
  page,
}) => {
  await openTasks(page);
  const rows = page.getByTestId('issue-row');
  const total = await rows.count();
  const first = (await rows.first().innerText()).split('\n').find((line) => line.length > 8)!;
  const needle = first.slice(0, 12);
  await search(page).click();
  await search(page).pressSequentially(needle, { delay: 0 });
  await expect(search(page)).toHaveValue(needle);
  await expect.poll(() => urlQuery(page)).toBe(needle);
  await expect.poll(() => rows.count()).toBeLessThanOrEqual(total);
  await expect(rows.first()).toContainText(needle);
  await page.reload();
  await expect(search(page)).toHaveValue(needle);
  expect(urlQuery(page)).toBe(needle);
  await search(page).fill('');
  await expect.poll(() => urlQuery(page)).toBeNull();
  await expect(search(page)).toHaveValue('');
});
test('navigating away and back adopts the URL query, not stale typed text', async ({ page }) => {
  await openTasks(page);
  await search(page).click();
  await search(page).pressSequentially('alpha', { delay: 0 });
  await expect.poll(() => urlQuery(page)).toBe('alpha');
  await page.getByRole('link', { name: 'My tasks', exact: true }).click();
  await expect(page).toHaveURL(/\/my-tasks/);
  expect(urlQuery(page)).toBeNull();
  await expect(search(page)).toHaveValue('');
  await page.goBack();
  await expect(page).toHaveURL(/\/tasks\?q=alpha/);
  await expect(search(page)).toHaveValue('alpha');
  await page.goForward();
  await expect(page).toHaveURL(/\/my-tasks/);
  await expect(search(page)).toHaveValue('');
});
test('typing then leaving the box straight away still commits the query', async ({ page }) => {
  await openTasks(page);
  await search(page).click();
  await search(page).pressSequentially('quick', { delay: 0 });
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await expect.poll(() => urlQuery(page)).toBe('quick');
  await expect(search(page)).toHaveValue('quick');
});
test('the word all is a query, not "no filter"', async ({ page }) => {
  await openTasks(page);
  await search(page).click();
  await search(page).pressSequentially('all', { delay: 0 });
  await expect.poll(() => urlQuery(page)).toBe('all');
  await page.waitForTimeout(600);
  await expect(search(page)).toHaveValue('all');
  expect(urlQuery(page)).toBe('all');
});
test('IME composition is not truncated and the URL waits for the committed text', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Playwright drives real IME composition only in Chromium');
  await openTasks(page);
  await search(page).click();
  const session = await page.context().newCDPSession(page);
  await session.send('Input.imeSetComposition', {
    text: 'に',
    selectionStart: 1,
    selectionEnd: 1,
  });
  await session.send('Input.imeSetComposition', {
    text: 'にほ',
    selectionStart: 2,
    selectionEnd: 2,
  });
  await expect(search(page)).toHaveValue('にほ');
  await page.waitForTimeout(600);
  expect(urlQuery(page)).toBeNull();
  await expect(search(page)).toHaveValue('にほ');
  await session.send('Input.insertText', { text: '日本' });
  await expect(search(page)).toHaveValue('日本');
  await expect.poll(() => urlQuery(page)).toBe('日本');
  await page.waitForTimeout(600);
  await expect(search(page)).toHaveValue('日本');
});
