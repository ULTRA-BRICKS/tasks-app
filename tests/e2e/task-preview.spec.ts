import { test, expect, type Locator, type Page } from '@playwright/test';
import { login, PAST_HOLD_MS, stubClipboard } from './session-fixture';

// Acceptance for docs/TASK-PREVIEW.md (UB-38, UB-31).

const previewOf = (page: Page) => page.getByRole('dialog', { name: 'Task preview', exact: true });
const firstTrigger = (page: Page) => page.getByRole('button', { name: /^Preview TKT-/ }).first();

/** Waits for running finite CSS animations and transitions inside the element. */
function settle(element: Locator) {
  return element.evaluate((el) =>
    Promise.all(
      el
        .getAnimations({ subtree: true })
        // A looping animation (a spinner) never finishes.
        .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
        .map((animation) => animation.finished.catch(() => null)),
    ),
  );
}

/**
 * The first value option whose label differs from `current`; a substring filter would skip
 * "Not Done" for "Done". Combobox commands (View profile) are options too, but never values.
 */
async function otherOption(list: Locator, current: string) {
  const values = list.getByRole('option').and(list.locator(':not(.combobox-command)'));
  await expect(values.first()).toBeVisible();
  const texts = await values.allInnerTexts();
  // The label is the first line; a description (an email) may follow it.
  const index = texts.findIndex((text) => text.split('\n')[0].trim() !== current);
  expect(index, texts.join()).toBeGreaterThanOrEqual(0);
  return values.nth(index);
}

/**
 * Puts a task's fields back after a test changed them: waits for the test's own save to answer,
 * then writes against the current version, so a failed assertion cannot leak the change.
 */
async function restoreIssue(
  page: Page,
  save: Promise<unknown>,
  id: string,
  data: Record<string, unknown>,
) {
  await save.catch(() => undefined);
  const current = await (await page.request.get('/api/v1/issues/' + id)).json();
  const restore = await page.request.patch('/api/v1/issues/' + id, {
    headers: { 'x-tickets-csrf': '1' },
    data: { ...data, version: current.version },
  });
  expect(restore.status()).toBe(200);
}

/** Splits an open button's accessible name, `TKT-1 Title words`, into the key and the title. */
async function keyAndTitle(open: Locator) {
  const [key, ...words] = (await open.getAttribute('aria-label'))!.split(' ');
  return { key, title: words.join(' ') };
}

/** Presses and holds the primary mouse button at the element's centre (or `dx` from its left). */
async function press(page: Page, target: Locator, dx?: number) {
  const box = (await target.boundingBox())!;
  const point = { x: box.x + (dx ?? box.width / 2), y: box.y + box.height / 2 };
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  return point;
}

/** A primary touch pointer's event fields at the element's centre, for raw pointer events. */
async function touchAt(target: Locator) {
  const box = (await target.boundingBox())!;
  return {
    pointerId: 9,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    clientX: box.x + box.width / 2,
    clientY: box.y + box.height / 2,
  };
}

test.describe('desktop', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('the preview toolbar offers Open, Status, Assign, Copy and More in one row', async ({
    page,
  }) => {
    await firstTrigger(page).click();
    const toolbar = previewOf(page).getByRole('toolbar', { name: 'Task preview actions' });
    await expect(toolbar.getByRole('button', { name: 'Open task', exact: true })).toBeVisible();
    await expect(toolbar.getByRole('combobox', { name: /^Status: / })).toBeVisible();
    await expect(toolbar.getByRole('combobox', { name: /^Assignee: / })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: 'Copy', exact: true })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: 'More actions', exact: true })).toBeVisible();
    // Measured after the enter transition: a scale in progress rounds the tops apart (WebKit).
    await settle(page.locator('.peek-surface'));
    const tops = await toolbar
      .locator('[data-peek-action]')
      .evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().top)));
    expect(tops).toHaveLength(5);
    expect(new Set(tops).size).toBe(1);
  });

  test('status picker from the preview saves through the shared mutation; Escape closes one layer at a time', async ({
    page,
  }) => {
    const detail = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        /\/api\/v1\/issues\/[^/?]+$/.test(new URL(response.url()).pathname),
    );
    const trigger = firstTrigger(page);
    await trigger.click();
    const before = await (await detail).json();
    const preview = previewOf(page);
    const status = preview.getByRole('combobox', { name: /^Status: / });
    await status.click();
    const list = page.getByRole('listbox');
    await expect(list).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(list).toHaveCount(0);
    await expect(preview).toBeVisible();
    await expect(status).toBeFocused();

    const assignee = preview.getByRole('combobox', { name: /^Assignee: / });
    await assignee.click();
    await expect(page.getByRole('option', { name: 'Unassigned' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(assignee).toBeFocused();

    await status.click();
    const target = await otherOption(list, before.status_name);
    const chosen = (await target.innerText()).trim();
    const patch = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname === '/api/v1/issues/' + before.id,
    );
    let clicked = false;
    try {
      await target.click();
      clicked = true;
      const saved = await patch;
      expect(saved.status()).toBe(200);
      const updated = await saved.json();
      expect(updated.status_name).toBe(chosen);
      await expect(preview).toHaveCount(0);
    } finally {
      // Restore the synthetic fixture for the following cases.
      if (clicked) await restoreIssue(page, patch, before.id, { status_id: before.status_id });
    }
  });

  test('copy in the preview offers link, task ID, branch name and prompt', async ({ page }) => {
    await stubClipboard(page);
    await firstTrigger(page).click();
    const preview = previewOf(page);
    await preview.getByRole('button', { name: 'Copy', exact: true }).click();
    for (const name of ['Copy link', 'Copy task ID', 'Copy branch name', 'Copy prompt'])
      await expect(page.getByRole('menuitem', { name, exact: true })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Copy branch name', exact: true }).click();
    await expect(preview).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.dataset.copied)).toMatch(
      /^tkt-\d+\/[a-z0-9-]+$/,
    );
  });

  test('closing animates out from the anchor and reopening mid-exit continues from the current frame', async ({
    page,
  }) => {
    const trigger = firstTrigger(page);
    await trigger.click();
    const surface = page.locator('.peek-surface');
    await expect(surface).toHaveAttribute('data-state', 'open');
    await settle(surface);
    const source = (await trigger.boundingBox())!;
    const origin = await surface.evaluate((el) => {
      const [x, y] = getComputedStyle(el).transformOrigin.split(' ').map(parseFloat);
      const box = el.getBoundingClientRect();
      return { x: box.left + x, y: box.top + y };
    });
    expect(origin.x).toBeGreaterThanOrEqual(source.x - 2);
    expect(origin.x).toBeLessThanOrEqual(source.x + source.width + 2);
    expect(origin.y).toBeGreaterThanOrEqual(source.y - 2);
    expect(origin.y).toBeLessThanOrEqual(source.y + source.height + 2);

    const mid = await surface.evaluate(async (el) => {
      Reflect.set(el, 'probe', true);
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
      await new Promise<void>((resolve) => {
        const check = () =>
          el.getAttribute('data-state') === 'closing' ? resolve() : requestAnimationFrame(check);
        check();
      });
      const running = el.getAnimations();
      for (const animation of running) {
        animation.pause();
        animation.currentTime = Number(animation.effect?.getTiming().duration ?? 0) / 2;
      }
      return { count: running.length, opacity: Number(getComputedStyle(el).opacity) };
    });
    expect(mid.count).toBeGreaterThan(0);
    expect(mid.opacity).toBeGreaterThan(0.05);
    expect(mid.opacity).toBeLessThan(0.95);
    // The exiting surface is out of the accessibility tree and focus is back on the source.
    await expect(previewOf(page)).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await trigger.click();
    await expect(surface).toHaveAttribute('data-state', 'open');
    const after = await surface.evaluate((el) => ({
      same: Reflect.get(el, 'probe') === true,
      opacity: Number(getComputedStyle(el).opacity),
    }));
    expect(after.same).toBe(true);
    expect(after.opacity).toBeGreaterThanOrEqual(mid.opacity - 0.05);
    await expect(previewOf(page)).toBeVisible();
    await expect(surface).toHaveCount(1);
  });

  test('a preview closed right after its ellipsis click stays closed', async ({ page }) => {
    // WebKit repeats pointerover around the click's pointer capture (seen after a row menu);
    // a hover-open armed then must not reopen the preview after Escape, where it used to
    // take the next menu's Escape.
    await page.getByTestId('issue-row').first().click({ button: 'right' });
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await firstTrigger(page).click();
    const surface = page.locator('.peek-surface');
    await expect(surface).toHaveAttribute('data-state', 'open');
    await page.keyboard.press('Escape');
    await expect(previewOf(page)).toHaveCount(0);
    await page.waitForTimeout(600); // Past the 500 ms hover delay, counted from the click.
    await expect(surface).toHaveCount(0);
  });

  test('reduced motion opens and closes without transforms or an exit delay', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const trigger = firstTrigger(page);
    await trigger.click();
    const surface = page.locator('.peek-surface');
    await expect(surface).toHaveAttribute('data-state', 'open');
    const animated = await surface.evaluate((el) =>
      el.getAnimations().map((animation) => (animation as CSSTransition).transitionProperty),
    );
    expect(animated).not.toContain('transform');
    await page.keyboard.press('Escape');
    await expect(surface).toHaveCount(0);
    // Specs sharing the server add other teams' rows above the seed, and the trigger click may
    // have scrolled those under the sticky header: hold the row of the task just previewed.
    const anchor = trigger.locator('..');
    const row = anchor.getByTestId('issue-row');
    await press(page, row.locator('.issue-open'), 24);
    await expect(anchor).toHaveAttribute('data-pressing', 'true');
    expect(await row.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
    await page.mouse.up();
  });

  test('hold shows press progress and cancels when the page is hidden', async ({ page }) => {
    const row = page.getByTestId('issue-row').first();
    await press(page, row.locator('.issue-open'), 24);
    const anchor = page.locator('.peek-anchor').first();
    await expect(anchor).toHaveAttribute('data-pressing', 'true');
    await expect.poll(() => row.evaluate((el) => getComputedStyle(el).transform)).not.toBe('none');
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(anchor).not.toHaveAttribute('data-pressing', 'true');
    await page.waitForTimeout(PAST_HOLD_MS);
    await expect(previewOf(page)).toHaveCount(0);
    await page.evaluate(() => Reflect.deleteProperty(document, 'visibilityState'));
    await page.mouse.up();
    // A cancelled press never turns into a click.
    await expect(page).toHaveURL(/\/tasks$/);
  });

  test('the tap right after a hold opens the task: no cooldown on the same row', async ({
    page,
  }) => {
    const title = page.getByTestId('issue-row').first().locator('.issue-open');
    await press(page, title, 24);
    await expect(previewOf(page)).toBeVisible();
    await page.mouse.up();
    await expect(previewOf(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await title.click({ position: { x: 24, y: 10 } });
    await expect(page).toHaveURL(/\/tasks\/[^/?]+/);
  });

  test('the tap right after a hold opens the task: a preview action works at once', async ({
    page,
  }) => {
    const title = page.getByTestId('issue-row').first().locator('.issue-open');
    await press(page, title, 24);
    const preview = previewOf(page);
    await expect(preview).toBeVisible();
    await page.mouse.up();
    await preview.getByRole('button', { name: 'Open task', exact: true }).click();
    await expect(page).toHaveURL(/\/tasks\/[^/?]+/);
  });

  test('Space peeks the focused task, restores focus, and is listed in the shortcut help', async ({
    page,
  }) => {
    const title = page.getByTestId('issue-row').first().locator('.issue-open');
    await title.focus();
    await page.keyboard.press('Space');
    await expect(previewOf(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(previewOf(page)).toHaveCount(0);
    await expect(title).toBeFocused();
    await page.keyboard.press('?');
    const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(help.getByText('Peek into the focused task', { exact: true })).toBeVisible();
    await expect(help.getByText('Space', { exact: true })).toBeVisible();
    await expect(help.getByText('Actions for the focused item', { exact: true })).toBeVisible();
    await expect(help.getByText('Shift F10', { exact: true })).toBeVisible();
  });

  test('the preview shows the task it was opened from; toolbar arrows wrap and Arrow Down opens a picker', async ({
    page,
  }) => {
    const row = page.getByTestId('issue-row').nth(1);
    const { key, title } = await keyAndTitle(row.locator('.issue-open'));
    await row
      .locator('..')
      .getByRole('button', { name: `Preview ${key}`, exact: true })
      .focus();
    await page.keyboard.press('Enter');
    const preview = previewOf(page);
    await expect(preview.locator('.peek-heading')).toContainText(key);
    await expect(preview.locator('.peek-content > h2')).toHaveText(title);
    const toolbar = preview.getByRole('toolbar', { name: 'Task preview actions' });
    const open = toolbar.getByRole('button', { name: 'Open task', exact: true });
    await expect(open).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(toolbar.getByRole('button', { name: 'More actions', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(open).toBeFocused();
    await page.keyboard.press('ArrowRight');
    const status = toolbar.getByRole('combobox', { name: /^Status: / });
    await expect(status).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(status).toBeFocused();
  });

  test('a board card holds its open button and assignee control side by side', async ({ page }) => {
    await page.getByRole('button', { name: 'Board view', exact: true }).click();
    // Specs sharing the server add other teams' cards before the seeded ones.
    const card = page
      .locator('.issue-card')
      .filter({ has: page.getByRole('button', { name: /^TKT-\d+ / }) })
      .first();
    const open = card.getByRole('button', { name: /^TKT-\d+ / });
    const assignee = card.getByRole('combobox', { name: /^Assignee for TKT-\d+: / });
    await expect(assignee).toBeVisible();
    // A combobox cannot nest inside the button that opens the task.
    await expect(card.locator('button [role="combobox"], button button')).toHaveCount(0);
    const cardBox = (await card.boundingBox())!,
      box = (await assignee.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
    expect(box.y + box.height).toBeLessThanOrEqual(cardBox.y + cardBox.height);

    const { key, title } = await keyAndTitle(open);
    const found = await (
      await page.request.get('/api/v1/issues?q=' + encodeURIComponent(title))
    ).json();
    const before = found.data.find((issue: { key: string }) => issue.key === key);
    const original = (await assignee.getAttribute('aria-label'))!.replace(/^[^:]+: /, '');
    await assignee.click();
    const option = await otherOption(page.getByRole('listbox'), original);
    const patch = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname === '/api/v1/issues/' + before.id,
    );
    let clicked = false;
    try {
      await option.click();
      clicked = true;
      const saved = await patch;
      expect(saved.status()).toBe(200);
      await expect(assignee).not.toHaveAttribute('aria-label', `Assignee for ${key}: ${original}`);
      await expect(previewOf(page)).toHaveCount(0);
      await expect(page).toHaveURL(/\/tasks$/);
    } finally {
      if (clicked)
        await restoreIssue(page, patch, before.id, { assignee_id: before.assignee_id ?? null });
    }
    await open.click();
    await expect(page).toHaveURL(/\/tasks\/[^/?]+/);
  });

  test('a long press or right-click inside a popup opened from a row neither holds the row nor opens its menu', async ({
    page,
  }) => {
    const row = page.getByTestId('issue-row').first();
    await row.getByRole('combobox', { name: /^Assignee for / }).click();
    const option = page.getByRole('listbox').getByRole('option').first();
    await expect(option).toBeVisible();
    const point = await touchAt(option);
    // React bubbles the portalled listbox's events through the row; the row must ignore them.
    await option.dispatchEvent('pointerdown', point);
    const anchor = row.locator('xpath=ancestor::*[contains(@class,"peek-anchor")][1]');
    expect(await anchor.getAttribute('data-pressing')).toBeNull();
    await page.waitForTimeout(PAST_HOLD_MS);
    await expect(previewOf(page)).toHaveCount(0);
    await option.dispatchEvent('contextmenu', {
      clientX: point.clientX,
      clientY: point.clientY,
      button: 2,
    });
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(previewOf(page)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0);
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 393, height: 852 }, hasTouch: true });

  test('long description is complete, attachments are listed and content keeps at least half the card', async ({
    page,
  }, info) => {
    const description =
      Array.from(
        { length: 60 },
        (_, index) => `Paragraph ${index + 1}: ` + 'a long preview sentence '.repeat(6),
      ).join('\n\n') + '\n\nEND-OF-DESCRIPTION';
    expect(description.length).toBeGreaterThan(6000);
    await page.route(/\/api\/v1\/issues\/[^/?]+$/, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({
        response,
        json: {
          ...body,
          description,
          attachments: [
            {
              id: 'att-1',
              filename: 'design-notes.pdf',
              mime: 'application/pdf',
              bytes: 48213,
              created_at: '2026-09-29T10:00:00Z',
            },
            {
              id: 'att-2',
              filename: 'screen.png',
              mime: 'image/png',
              bytes: 2048,
              created_at: '2026-09-29T10:00:00Z',
            },
          ],
        },
      });
    });
    await login(page);
    await firstTrigger(page).tap();
    const preview = previewOf(page);
    await expect(preview).toBeVisible();
    await expect(preview.getByText('END-OF-DESCRIPTION')).toBeAttached();
    await expect(preview.getByRole('link', { name: /design-notes\.pdf/ })).toHaveAttribute(
      'href',
      '/api/v1/attachments/att-1/content',
    );
    const surface = page.locator('.peek-surface');
    await settle(surface);
    const layout = await surface.evaluate((el) => {
      const content = el.querySelector('.peek-content')!;
      const toolbar = el.querySelector('[role="toolbar"]')!.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      return {
        share: content.getBoundingClientRect().height / box.height,
        scrolls: content.scrollHeight > content.clientHeight + 1,
        width: box.width,
        top: box.top,
        bottom: box.bottom,
        toolbarBottom: toolbar.bottom,
        viewport: { width: innerWidth, height: innerHeight },
      };
    });
    expect(layout.share, JSON.stringify(layout)).toBeGreaterThanOrEqual(0.5);
    expect(layout.scrolls).toBe(true);
    expect(layout.width).toBeGreaterThanOrEqual(layout.viewport.width - 25);
    expect(layout.top).toBeGreaterThanOrEqual(0);
    expect(layout.toolbarBottom).toBeLessThanOrEqual(layout.bottom);
    expect(layout.bottom).toBeLessThanOrEqual(layout.viewport.height - 12 + 1);
    for (const control of await preview.locator('[data-peek-action]').all()) {
      const box = (await control.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    // One label size for buttons and pickers: the touch rule that keeps form fields at 16px
    // (no iOS focus zoom) also matches the Status and Assign pickers (role=combobox).
    const sizes = await preview
      .locator('.peek-tool-label')
      .evaluateAll((labels) => labels.map((label) => getComputedStyle(label).fontSize));
    expect(new Set(sizes).size, sizes.join()).toBe(1);
    await page.screenshot({ path: info.outputPath('phone-long-preview.png') });
    await preview.locator('.peek-content').evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(preview.getByText('END-OF-DESCRIPTION')).toBeInViewport();
    await expect(preview.getByRole('toolbar')).toBeInViewport({ ratio: 1 });
    // Tapping the dimmed page dismisses without opening the task underneath.
    await page.mouse.click(200, 20);
    await expect(preview).toHaveCount(0);
    await expect(page).toHaveURL(/\/tasks$/);
  });

  test('the phone preview stays above the bottom safe area', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Only Chromium can emulate safe-area insets (CDP).');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', {
      insets: { bottom: 34, bottomMax: 34 },
    });
    await login(page);
    await firstTrigger(page).tap();
    const surface = page.locator('.peek-surface');
    await expect(surface).toHaveAttribute('data-state', 'open');
    await settle(surface);
    const box = (await surface.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(852 - 34 - 12 + 1);
  });

  test('holding the assignee avatar opens the preview at the Assign action', async ({ page }) => {
    await login(page);
    const avatar = page.getByTestId('issue-row').first().locator('.avatar-picker');
    const point = await touchAt(avatar);
    await avatar.dispatchEvent('pointerdown', point);
    await expect(
      avatar.locator('xpath=ancestor::*[contains(@class,"peek-anchor")]'),
    ).toHaveAttribute('data-pressing', 'true');
    const preview = previewOf(page);
    await expect(preview).toBeVisible();
    await avatar.dispatchEvent('pointerup', point);
    await expect(preview.getByRole('combobox', { name: /^Assignee: / })).toBeFocused();
    await expect(page.getByRole('listbox')).toHaveCount(0);
  });
});
