import { test, expect, type Page, type BrowserContext } from '@playwright/test';
let cookies: Awaited<ReturnType<BrowserContext['cookies']>> | undefined;
async function login(page: Page) {
  if (cookies) {
    await page.context().addCookies(cookies);
    await page.goto('/issues');
    await expect(page.getByTestId('issue-row').first()).toBeVisible();
    return;
  }
  await page.goto('/issues');
  await page.getByLabel('Email', { exact: true }).fill('demo@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-demo-password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByTestId('issue-row').first()).toBeVisible();
  cookies = await page.context().cookies();
}

test('an unsent comment survives navigation and a reload', async ({ page }) => {
  await login(page);
  await page.locator('.issue-open').first().click();
  const url = page.url();
  const comment = page.getByRole('textbox', { name: 'Comment', exact: true });
  await comment.fill('Unsent local comment — keep every character.');
  await page.getByRole('button', { name: 'Close issue', exact: true }).click();
  await page.goto(url);
  await expect(comment).toHaveValue('Unsent local comment — keep every character.');
  await page.reload();
  await expect(comment).toHaveValue('Unsent local comment — keep every character.');
});

test('a closed tab recovers the unsent new issue without submitting it', async ({
  page,
  context,
}) => {
  await login(page);
  await page.goto('/issues/new');
  await page
    .getByRole('textbox', { name: 'Title', exact: true })
    .fill('Recover after closing the tab');
  await page
    .getByRole('textbox', { name: 'Description', exact: true })
    .fill('Unsaved body with punctuation: αβ — 123.');
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto('/issues/new');
  await expect(reopened.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(
    'Recover after closing the tab',
  );
  await expect(reopened.getByRole('textbox', { name: 'Description', exact: true })).toContainText(
    'Unsaved body with punctuation: αβ — 123.',
  );
  await expect(reopened.getByRole('button', { name: 'Create issue', exact: true })).toBeEnabled();
  await expect(reopened).toHaveURL(/\/issues\/new$/);
});

test('two tabs retain different comment copies for the same issue', async ({ page, context }) => {
  await login(page);
  await page.locator('.issue-open').first().click();
  const url = page.url(),
    other = await context.newPage();
  await other.goto(url);
  await page.getByRole('textbox', { name: 'Comment', exact: true }).fill('First tab private draft');
  await other
    .getByRole('textbox', { name: 'Comment', exact: true })
    .fill('Second tab private draft');
  await page.reload();
  await other.reload();
  await expect(page.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue(
    'First tab private draft',
  );
  await expect(other.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue(
    'Second tab private draft',
  );
  await page.goto('/drafts');
  await expect(page.getByText('First tab private draft', { exact: true })).toBeVisible();
  await expect(page.getByText('Second tab private draft', { exact: true })).toBeVisible();
});

test('a late comment acknowledgement cannot erase text typed after navigating back', async ({
  page,
}) => {
  await login(page);
  await page.locator('.issue-open').first().click();
  const path = new URL(page.url()).pathname,
    comment = page.getByRole('textbox', { name: 'Comment', exact: true });
  let release!: () => void, observed!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const received = new Promise<void>((resolve) => {
    observed = resolve;
  });
  await page.route('**/api/v1/issues/*/comments', async (route) => {
    const response = await route.fetch();
    observed();
    await held;
    await route.fulfill({ response });
  });
  await comment.fill('Earlier submitted comment');
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  await received;
  await page.getByRole('button', { name: 'Close issue', exact: true }).click();
  await page.locator('.issue-open').first().click();
  await expect(page).toHaveURL(new RegExp(path + '$'));
  await comment.fill('New unsent comment typed after return');
  release();
  await expect(comment).toHaveValue('New unsent comment typed after return');
  await page.reload();
  await expect(comment).toHaveValue('New unsent comment typed after return');
});

test('date popup keeps a date that was entered but not applied', async ({ page }) => {
  await login(page);
  await page.goto('/issues/new');
  await page.getByRole('button', { name: 'Due date', exact: true }).click();
  await page.getByLabel('Due date value', { exact: true }).fill('2026-12-23');
  await page.keyboard.press('Escape');
  await page.reload();
  await page.getByRole('button', { name: 'Due date', exact: true }).click();
  await expect(page.getByLabel('Due date value', { exact: true })).toHaveValue('2026-12-23');
});

test('storage failures preserve memory and expose an export instead of claiming saved', async ({
  page,
}) => {
  await login(page);
  await page.locator('.issue-open').first().click();
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('No storage', 'QuotaExceededError');
    };
  });
  await page
    .getByRole('textbox', { name: 'Comment', exact: true })
    .fill('Memory-only recovery text');
  await expect(
    page.getByRole('alert').filter({ hasText: 'Draft backup needs attention' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close issue', exact: true }).click();
  await page.getByRole('link', { name: 'Draft recovery', exact: true }).click();
  await expect(page.getByText('Memory-only recovery text', { exact: true })).toBeVisible();
  const exported = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export drafts', exact: true }).last().click();
  expect((await exported).suggestedFilename()).toMatch(/^tickets-drafts.*\.json$/);
});

test('settings retain an unfinished label and never persist the login password', async ({
  page,
}) => {
  await login(page);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Workflow', exact: true }).click();
  await page.getByLabel('New label name', { exact: true }).fill('My unfinished label');
  await page.reload();
  await page.getByRole('button', { name: 'Workflow', exact: true }).click();
  await expect(page.getByLabel('New label name', { exact: true })).toHaveValue(
    'My unfinished label',
  );
  const checks = await page.evaluate(() => {
    let containsTestPassword = false,
      containsDraftLabel = false;
    for (const store of [sessionStorage, localStorage]) {
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        const value = key === null ? '' : (store.getItem(key) ?? '');
        containsTestPassword ||= value.includes('local-demo-password');
        containsDraftLabel ||= value.includes('My unfinished label');
      }
    }
    // Return only assertions about the synthetic fixture, never storage contents.
    return { containsTestPassword, containsDraftLabel };
  });
  expect(checks.containsTestPassword).toBe(false);
  expect(checks.containsDraftLabel).toBe(true);
});

test('equal-clock acknowledgement does not resurrect the submitted mirror', async ({
  page,
  context,
}) => {
  await login(page);
  await page.locator('.issue-open').first().click();
  const url = page.url();
  await page.evaluate(() => {
    Date.now = () => 1000000;
  });
  await page
    .getByRole('textbox', { name: 'Comment', exact: true })
    .fill('One exact revision to acknowledge');
  const sender = await context.newPage();
  await sender.goto(url);
  await sender.evaluate(() => {
    Date.now = () => 1000000;
  });
  await expect(sender.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue(
    'One exact revision to acknowledge',
  );
  await sender.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(sender.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue('');
  await page.close();
  await sender.close();
  const recovered = await context.newPage();
  await recovered.goto(url);
  await expect(recovered.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue('');
});

test('acknowledging one tab never masks another tabs unsent revision', async ({
  page,
  context,
}) => {
  await login(page);
  await page.locator('.issue-open').first().click();
  const url = page.url(),
    other = await context.newPage();
  await other.goto(url);
  await page.getByRole('textbox', { name: 'Comment', exact: true }).fill('Send only this tab');
  await other
    .getByRole('textbox', { name: 'Comment', exact: true })
    .fill('Keep the independent unsent tab');
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue('');
  await page.close();
  await other.close();
  const recovered = await context.newPage();
  await recovered.goto(url);
  await expect(recovered.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue(
    'Keep the independent unsent tab',
  );
});

test('later comments do not erase the acknowledgement of an earlier adopted copy', async ({
  page,
  context,
}) => {
  await login(page);
  await page.locator('.issue-open').first().click();
  const url = page.url();
  await page
    .getByRole('textbox', { name: 'Comment', exact: true })
    .fill('Already submitted adopted copy');
  const sender = await context.newPage();
  await sender.goto(url);
  const input = sender.getByRole('textbox', { name: 'Comment', exact: true });
  await expect(input).toHaveValue('Already submitted adopted copy');
  await sender.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(input).toHaveValue('');
  await input.fill('A different later submission');
  await sender.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(input).toHaveValue('');
  await page.close();
  await sender.close();
  const reopened = await context.newPage();
  await reopened.goto(url);
  await expect(reopened.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue('');
});

test('a changed adopted copy does not acknowledge the original text in another tab', async ({
  page,
  context,
}) => {
  await login(page);
  await page.locator('.issue-open').first().click();
  const url = page.url();
  await page.getByRole('textbox', { name: 'Comment', exact: true }).fill('Original unsent text');
  const sender = await context.newPage();
  await sender.goto(url);
  await sender
    .getByRole('textbox', { name: 'Comment', exact: true })
    .fill('Changed text sent by another tab');
  await sender.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(sender.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue('');
  await page.close();
  await sender.close();
  const reopened = await context.newPage();
  await reopened.goto(url);
  await expect(reopened.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue(
    'Original unsent text',
  );
});

test('a durable edit wins over this tabs stale mirror after a reload', async ({ page }) => {
  await login(page);
  await page.locator('.issue-open').first().click();
  const input = page.getByRole('textbox', { name: 'Comment', exact: true });
  await input.fill('Older mirrored version');
  await page.reload();
  await expect(input).toHaveValue('Older mirrored version');
  await page.evaluate(() => {
    const original = Object.getOwnPropertyDescriptor(Storage.prototype, 'setItem')!.value as (
      this: Storage,
      key: string,
      value: string,
    ) => void;
    Storage.prototype.setItem = function (key, value) {
      if (this === sessionStorage)
        throw new DOMException('Synthetic tab quota', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await input.fill('Newer version retained in durable storage');
  await page.reload();
  await expect(input).toHaveValue('Newer version retained in durable storage');
});

test('clock rollback cannot hide an unacknowledged independent copy', async ({ page, context }) => {
  await login(page);
  await page.locator('.issue-open').first().click();
  const url = page.url(),
    sender = await context.newPage();
  await sender.goto(url);
  await page.evaluate(() => {
    Date.now = () => 2000000;
  });
  await page
    .getByRole('textbox', { name: 'Comment', exact: true })
    .fill('Retained despite clock rollback');
  await sender.evaluate(() => {
    Date.now = () => 1;
  });
  await sender
    .getByRole('textbox', { name: 'Comment', exact: true })
    .fill('Only send this independent copy');
  await sender.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(sender.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue('');
  await page.close();
  await sender.close();
  const reopened = await context.newPage();
  await reopened.goto(url);
  await expect(reopened.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue(
    'Retained despite clock rollback',
  );
});
