import { test, expect } from '@playwright/test';
import { login } from './session-fixture';
test('cycle help opens a full-screen guide without changing the cycle or losing a new task draft', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await login(page);
    await page.goto('/issues/new');
    const title = page.getByRole('textbox', { name: 'Title', exact: true });
    await title.fill('Unsent planning question');
    let writes = 0;
    page.on('request', (request) => {
      if (request.url().includes('/api/') && !['GET', 'HEAD'].includes(request.method())) writes++;
    });
    const help = page.getByRole('button', { name: 'About cycles', exact: true });
    await help.click();
    await expect(page.getByRole('dialog', { name: 'What is a cycle?', exact: true })).toBeVisible();
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await page.getByRole('button', { name: 'Read full guide', exact: true }).click();
    const guide = page.getByRole('dialog', { name: 'Cycles in Tasks', exact: true });
    await expect(guide).toBeVisible();
    const bounds = await guide.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.width).toBeLessThanOrEqual(393);
    expect(bounds!.height).toBeGreaterThan(700);
    await expect(
      guide.getByRole('heading', { name: 'Cycle, project or status?', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(guide).toHaveCount(0);
    await expect(help).toBeFocused();
    await expect(title).toHaveValue('Unsent planning question');
    await expect(page.getByRole('combobox', { name: 'Cycle', exact: true })).toHaveText(/No cycle/);
    expect(writes).toBe(0);
  } finally {
    await context.close();
  }
});
test('a keyboard user can read and dismiss the cycle hint without opening the picker', async ({
  page,
}) => {
  await login(page);
  await page.locator('.issue-open').first().click();
  const help = page.getByRole('button', { name: 'About cycles', exact: true });
  await help.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'What is a cycle?', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(help).toBeFocused();
});

test('cycle guide footer and close button remain usable on a short phone without changing work', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 568 },
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await login(page);
    await page.locator('.issue-open').first().click();
    const help = page.getByRole('button', { name: 'About cycles', exact: true });
    let mutations = 0;
    page.on('request', (request) => {
      if (request.url().includes('/api/') && !['GET', 'HEAD'].includes(request.method()))
        mutations++;
    });
    for (const close of ['Back to task', 'Close dialog']) {
      await help.click();
      await page.getByRole('button', { name: 'Read full guide', exact: true }).click();
      const guide = page.getByRole('dialog', { name: 'Cycles in Tasks', exact: true });
      await expect(guide).toBeVisible();
      await guide.getByRole('region', { name: 'Cycle guide', exact: true }).evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect(guide.getByRole('heading', { name: 'An example', exact: true })).toBeVisible();
      await expect(
        guide.getByRole('button', { name: 'Back to task', exact: true }),
      ).toBeInViewport();
      await guide.getByRole('button', { name: close, exact: true }).click();
      await expect(guide).toHaveCount(0);
      await expect(help).toBeFocused();
    }
    expect(mutations).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
  } finally {
    await context.close();
  }
});
