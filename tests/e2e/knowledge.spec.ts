import { test, expect, type Page, type BrowserContext } from '@playwright/test';
let cookies: Awaited<ReturnType<BrowserContext['cookies']>> | undefined;
async function login(page: Page) {
  if (cookies) {
    await page.context().addCookies(cookies);
    await page.goto('/issues');
    await expect(page.getByTestId('issue-row').first()).toBeVisible();
    return;
  }
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('demo@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-demo-password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByTestId('issue-row').first()).toBeVisible();
  cookies = await page.context().cookies();
}

test('document creation is page-first, retains the unsent draft and saves inline edits', async ({
  page,
  browserName,
}) => {
  await login(page);
  await page.goto('/documents/new');
  const name = 'Knowledge fixture ' + browserName;
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  const body = page.getByRole('textbox', { name: 'Description', exact: true });
  await title.fill(name);
  await body.fill('Retain this unsent document body.');
  await page.getByRole('link', { name: 'Back to documents', exact: true }).click();
  await expect(page.getByRole('link', { name, exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'New document', exact: true }).click();
  await expect(title).toHaveValue(name);
  await expect(body).toContainText('Retain this unsent document body.');
  await page.getByRole('button', { name: 'Create document', exact: true }).click();
  await expect(page).toHaveURL(/\/documents\/[a-f0-9-]{36}$/);
  const edited = name + ' revised';
  const saved = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && r.url().includes('/api/v1/documents/'),
  );
  await title.fill(edited);
  await title.press('Enter');
  expect((await saved).status()).toBe(200);
  await page.reload();
  await expect(title).toHaveValue(edited);
  await expect(body).toContainText('Retain this unsent document body.');
});

test('an initiative keeps its status and linked projects after reload', async ({
  page,
  browserName,
}) => {
  await login(page);
  const catalog = await (await page.request.get('/api/v1/catalog')).json();
  const projectName = 'Linked project ' + browserName;
  const project = await (
    await page.request.post('/api/v1/projects', {
      headers: { Origin: new URL(page.url()).origin, 'x-tickets-csrf': '1' },
      data: { name: projectName, team_ids: [catalog.teams[0].id] },
    })
  ).json();
  expect(project.id).toBeTruthy();
  await page.goto('/initiatives/new');
  await page
    .getByRole('textbox', { name: 'Title', exact: true })
    .fill('Initiative fixture ' + browserName);
  await page.getByRole('combobox', { name: 'Status', exact: true }).click();
  await page.getByRole('option', { name: 'Active', exact: true }).click();
  await page.getByRole('combobox', { name: 'Link project', exact: true }).click();
  await page.getByRole('option', { name: projectName, exact: true }).click();
  await page.getByRole('button', { name: 'Create initiative', exact: true }).click();
  await expect(page).toHaveURL(/\/initiatives\/[a-f0-9-]{36}$/);
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Status', exact: true })).toContainText('Active');
  await expect(page.getByRole('link', { name: projectName, exact: true })).toHaveAttribute(
    'href',
    '/projects/' + project.id,
  );
  await page.setViewportSize({ width: 393, height: 852 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(393);
});

test('archived documents remain discoverable and can be restored from the UI', async ({
  page,
  browserName,
}) => {
  await login(page);
  await page.goto('/documents/new');
  const name = 'Archive fixture ' + browserName;
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill(name);
  await page.getByRole('button', { name: 'Create document', exact: true }).click();
  await expect(page).toHaveURL(/\/documents\/[a-f0-9-]{36}$/);
  await page.getByRole('button', { name: 'document actions', exact: true }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('menuitem', { name: 'Archive document', exact: true }).click();
  await expect(page).toHaveURL(/\/documents$/);
  await expect(page.locator('.knowledge-row').filter({ hasText: name })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show archived', exact: true }).click();
  const row = page.locator('.knowledge-row').filter({ hasText: name });
  await expect(row).toBeVisible();
  await row.click();
  await page.getByRole('button', { name: 'document actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Restore document', exact: true }).click();
  await expect(page).toHaveURL(/\/documents$/);
  await expect(page.locator('.knowledge-row').filter({ hasText: name })).toBeVisible();
});

for (const kind of ['documents', 'initiatives'] as const) {
  test(`an ambiguous ${kind} create can be retried after reload without duplication`, async ({
    page,
    browserName,
  }) => {
    await login(page);
    const noun = kind === 'documents' ? 'document' : 'initiative';
    const name = 'Retry fixture ' + noun + ' ' + browserName;
    const attempts: { body: string | null; key: string | undefined }[] = [];
    await page.route('**/api/v1/' + kind, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      attempts.push({
        body: route.request().postData(),
        key: route.request().headers()['idempotency-key'],
      });
      const response = await route.fetch();
      if (attempts.length === 1)
        return route.fulfill({
          status: 503,
          json: {
            error: {
              code: 'TEST_RESPONSE_LOST',
              message: 'The server response could not be confirmed.',
            },
          },
        });
      await route.fulfill({ response });
    });
    await page.goto('/' + kind + '/new');
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill(name);
    await page.getByRole('button', { name: 'Create ' + noun, exact: true }).click();
    await expect(page.getByText('The server response could not be confirmed.')).toBeVisible();
    await page.reload();
    const retry = page.getByRole('button', {
      name: new RegExp('^(Create|Retry creating) ' + noun + '$'),
    });
    await expect(retry).toBeEnabled();
    await retry.click();
    await expect(page).toHaveURL(new RegExp('/' + kind + '/[a-f0-9-]{36}$'));
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toEqual(attempts[1]);
    const rows = await (await page.request.get('/api/v1/' + kind)).json();
    expect(
      rows.filter((row: { title?: string; name?: string }) => (row.title ?? row.name) === name),
    ).toHaveLength(1);
  });
}
