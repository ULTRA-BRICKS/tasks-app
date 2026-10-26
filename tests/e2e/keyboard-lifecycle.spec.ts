import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  // Fixed wall-clock keeps chord tests inside their deadline without freezing timers.
  await page.clock.setFixedTime(new Date('2026-10-26T12:00:00Z'));
});
for (const backend of ['baseline', 'state-lib'])
  for (const strict of [false, true]) {
    const mode = strict ? '&strict=1' : '';
    const title = backend + (strict ? ' StrictMode' : '');
    test(`${title}: a truly expired chord does not navigate`, async ({ page }) => {
      await page.goto(`/tests/browser/keyboard-lifecycle.html?backend=${backend}${mode}`);
      await expect(page.getByTestId('passive-route')).toHaveText('/issues/start');
      await page.keyboard.press('g');
      await page.clock.setFixedTime(new Date('2026-10-26T12:00:01.001Z'));
      await page.keyboard.press('p');
      await expect(page.getByTestId('route')).toHaveText('/issues/start');
    });

    test(`${title}: an event at the new route commit observes the new route, not the previous detail`, async ({
      page,
    }) => {
      await page.goto(`/tests/browser/keyboard-lifecycle.html?backend=${backend}${mode}&escape=1`);
      await expect(page.getByTestId('passive-route')).toHaveText('/issues/start');
      await page
        .getByRole('button', { name: 'Navigate and begin chord at commit', exact: true })
        .click();
      await expect(page.getByTestId('passive-route')).toHaveText('/issues');
      await expect(page.getByTestId('route')).toHaveText('/issues');
    });

    test(`${title}: the first committed list accepts keyboard input before passive effects`, async ({
      page,
    }) => {
      await page.goto(`/tests/browser/keyboard-lifecycle.html?backend=${backend}${mode}&startup=1`);
      await expect(page.getByTestId('passive-route')).toHaveText('/issues/start');
      await expect(page.getByRole('button', { name: 'First visible issue' })).toBeFocused();
    });

    test(`${title}: route commit must not erase a chord accepted on the new page`, async ({
      page,
    }) => {
      await page.goto(`/tests/browser/keyboard-lifecycle.html?backend=${backend}${mode}`);
      await expect(page.getByTestId('passive-route')).toHaveText('/issues/start');
      await page
        .getByRole('button', { name: 'Navigate and begin chord at commit', exact: true })
        .click();
      await expect(page.getByTestId('passive-route')).toHaveText('/issues');
      await page.keyboard.press('p');
      await expect(page.getByTestId('route')).toHaveText('/projects');
    });
    test(`${title}: a chord from the old page cannot cross navigation, editor text stays ordinary text`, async ({
      page,
    }) => {
      await page.goto(`/tests/browser/keyboard-lifecycle.html?backend=${backend}${mode}`);
      await expect(page.getByTestId('passive-route')).toHaveText('/issues/start');
      await page.keyboard.press('g');
      await page
        .getByRole('button', { name: 'Navigate without beginning chord', exact: true })
        .click();
      await expect(page.getByTestId('passive-route')).toHaveText('/issues');
      await page.keyboard.press('p');
      await expect(page.getByTestId('route')).toHaveText('/issues');
      await page.getByRole('textbox', { name: 'Editor text' }).focus();
      await page.keyboard.type('gp');
      await expect(page.getByRole('textbox', { name: 'Editor text' })).toHaveValue('gp');
      await expect(page.getByTestId('route')).toHaveText('/issues');
    });
  }
