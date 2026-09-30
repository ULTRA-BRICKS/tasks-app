import { test, expect, type Locator, type Page } from '@playwright/test';
import { login } from './session-fixture';

test.use({ viewport: { width: 393, height: 740 }, hasTouch: true });

async function denseTasks(page: Page, incoming: () => boolean = () => false) {
  await page.route('**/api/v1/issues?*', async (route) => {
    const body = await (await route.fetch()).json();
    expect(body.data.length, 'the synthetic fixture must provide a task to clone').toBeGreaterThan(
      0,
    );
    const [first] = body.data;
    const rows = Array.from({ length: 35 }, (_, i) => ({
      ...first,
      id: `11111111-1111-4111-8111-${String(i + 1).padStart(12, '0')}`,
      key: `TKT-${1001 + i}`,
      title: `Mobile scrolling task ${i + 1}`,
    }));
    if (incoming())
      rows.unshift({
        ...first,
        id: '22222222-2222-4222-8222-000000000001',
        key: 'TKT-1999',
        title: 'Incoming mobile task',
      });
    await route.fulfill({ json: { ...body, next_cursor: null, data: rows } });
  });
  await login(page);
}

/** Waits for running CSS transitions; a transition cancelled by a later scroll also counts as settled. */
function settle(element: Locator) {
  return element.evaluate((el) =>
    Promise.all(
      el.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => null)),
    ),
  );
}

/** Vertical distance from the sticky page header's bottom edge to the target's top edge. */
function belowHeader(target: Locator, header: string) {
  return target.evaluate(
    (el, selector) =>
      el.getBoundingClientRect().top -
      document.querySelector(selector)!.getBoundingClientRect().bottom,
    header,
  );
}

async function scrollPaddingBelowHeader(page: Page, header: string) {
  return page.evaluate(
    (selector) =>
      parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) -
      document.querySelector(selector)!.getBoundingClientRect().bottom,
    header,
  );
}

test('mobile dock is compact, close to the safe edge, and translucent without shrinking hit targets', async ({
  page,
}, info) => {
  await login(page);
  const dock = page.locator('.mobile-dock');
  const box = (await dock.boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(56);
  expect(740 - box.y - box.height).toBeLessThanOrEqual(8);
  const links = await dock.locator('.nav-item').all();
  for (const link of links) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const background = await dock.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(background).toMatch(/(?:0\.[3-6]\d*|[3-6]\d%)\s*\)$/);
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('compact-glass-dock.png'),
  });
});

test('board horizontal scrolling stays inside its region instead of moving the page header', async ({
  page,
}, info) => {
  await denseTasks(page);
  await page.getByRole('button', { name: 'Board view', exact: true }).click();
  await expect(page.locator('.board')).toBeVisible();
  const header = page.locator('.page-toolbar');
  const before = (await header.boundingBox())!;
  const scroller = page.locator('.issues-content');
  await scroller.evaluate((el) => {
    el.scrollLeft = 450;
  });
  await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(200);
  await page.evaluate(() => window.scrollTo(450, 0));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(393);
  expect((await header.boundingBox())!.x).toBeCloseTo(before.x, 0);
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('board-horizontal-contained.png'),
  });
});

test('list group heading sticks immediately below the shrinking page header with a glass surface', async ({
  page,
}, info) => {
  await denseTasks(page);
  const toolbar = page.locator('.page-toolbar');
  const expandedHeight = (await toolbar.boundingBox())!.height;
  await page.evaluate(() => window.scrollTo(0, 420));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
  await expect
    .poll(async () => (await toolbar.boundingBox())!.height)
    .toBeLessThan(expandedHeight - 10);
  await settle(toolbar);
  const group = page.locator('.group-heading').first();
  const gap = await group.evaluate(
    (el) =>
      el.getBoundingClientRect().top -
      document.querySelector('.page-toolbar')!.getBoundingClientRect().bottom,
  );
  expect(gap).toBeGreaterThanOrEqual(-1);
  expect(gap).toBeLessThanOrEqual(2);
  expect(await group.evaluate((el) => getComputedStyle(el).backdropFilter)).not.toBe('none');
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('sticky-glass-group.png'),
  });
});

test('board column headings remain visible when their own cards scroll vertically', async ({
  page,
}, info) => {
  await denseTasks(page);
  await page.getByRole('button', { name: 'Board view', exact: true }).click();
  const scroller = page.locator('.issues-content');
  const heading = page
    .locator('.board-column')
    .filter({ has: page.locator('.issue-card') })
    .first()
    .locator(':scope > header');
  const before = (await heading.boundingBox())!;
  await scroller.evaluate((el) => {
    el.scrollTop = 400;
  });
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(250);
  const after = (await heading.boundingBox())!;
  expect(after.y).toBeGreaterThanOrEqual((await scroller.boundingBox())!.y - 1);
  expect(after.y).toBeLessThanOrEqual(before.y + 1);
  expect(await heading.evaluate((el) => getComputedStyle(el).backdropFilter)).not.toBe('none');
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('sticky-board-columns.png'),
  });
});

test('scrolling the board region compacts the page header and collapses the dock like document scrolling', async ({
  page,
}) => {
  await denseTasks(page);
  await page.getByRole('button', { name: 'Board view', exact: true }).click();
  const toolbar = page.locator('.page-toolbar');
  const dock = page.locator('.mobile-navigation-bar');
  const expandedHeight = (await toolbar.boundingBox())!.height;
  const scroller = page.locator(".issues-content[data-view='board']");
  await scroller.evaluate((el) => {
    el.scrollTop = 400;
  });
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(250);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect
    .poll(async () => (await toolbar.boundingBox())!.height)
    .toBeLessThan(expandedHeight - 10);
  await expect(dock).toHaveAttribute('data-collapsed', 'true');
  await scroller.evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect
    .poll(async () => (await toolbar.boundingBox())!.height)
    .toBeGreaterThan(expandedHeight - 1);
  await expect(dock).toHaveAttribute('data-collapsed', 'false');
});

test('after the header settles, a short upward board scroll expands the dock like document scrolling', async ({
  page,
}) => {
  await denseTasks(page);
  await page.getByRole('button', { name: 'Board view', exact: true }).click();
  const toolbar = page.locator('.page-toolbar');
  const dock = page.locator('.mobile-navigation-bar');
  const expandedHeight = (await toolbar.boundingBox())!.height;
  const scroller = page.locator(".issues-content[data-view='board']");
  await scroller.evaluate((el) => {
    el.scrollTop = 400;
  });
  await expect(dock).toHaveAttribute('data-collapsed', 'true');
  // The header finishes shrinking while nothing scrolls; the board region is never scroll-anchored.
  await expect
    .poll(async () => (await toolbar.boundingBox())!.height)
    .toBeLessThan(expandedHeight - 10);
  await settle(toolbar);
  await scroller.evaluate((el) => {
    el.scrollTop -= 20;
  });
  await expect(dock).toHaveAttribute('data-collapsed', 'false');
});

test('leaving a scrolled board for a page without a sticky header shows the full dock and header state', async ({
  page,
}) => {
  await denseTasks(page);
  await page.getByRole('button', { name: 'Board view', exact: true }).click();
  const dock = page.locator('.mobile-navigation-bar');
  await page.locator(".issues-content[data-view='board']").evaluate((el) => {
    el.scrollTop = 400;
  });
  await expect(dock).toHaveAttribute('data-collapsed', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-header-compact', 'true');
  // A tap on iOS does not focus the link, so no focus event may refresh the chrome. Drop the
  // Board view button's focus first and let its frame run while the board is still there.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.evaluate(() => {
    const { promise, resolve } = Promise.withResolvers<void>();
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    return promise;
  });
  await expect(dock).toHaveAttribute('data-collapsed', 'true');
  // Client-side navigation; the documents list has no sticky page header.
  await page.evaluate(() => {
    history.pushState({}, '', '/documents');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page).toHaveURL(/\/documents$/);
  await expect(page.locator(".issues-content[data-view='board']")).toHaveCount(0);
  await expect(dock).toHaveAttribute('data-collapsed', 'false');
  await expect(page.locator('html')).not.toHaveAttribute('data-header-compact', /.*/);
});

test('on a phone with a bottom safe-area inset the board region ends above the dock without page scrolling', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Only Chromium can emulate safe-area insets (CDP).');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { bottom: 34, bottomMax: 34 } });
  await denseTasks(page);
  await page.getByRole('button', { name: 'Board view', exact: true }).click();
  const scroller = page.locator(".issues-content[data-view='board']");
  await expect(scroller).toBeVisible();
  await settle(page.locator('.page-toolbar'));
  const layout = await scroller.evaluate((el) => ({
    boardBottom: el.getBoundingClientRect().bottom,
    dockTop: document.querySelector('.mobile-dock')!.getBoundingClientRect().top,
    pageOverflow: document.documentElement.scrollHeight - window.innerHeight,
  }));
  expect(layout.boardBottom, JSON.stringify(layout)).toBeLessThanOrEqual(layout.dockTop);
  expect(layout.pageOverflow, JSON.stringify(layout)).toBeLessThanOrEqual(1);
});

for (const viewport of [
  { width: 820, height: 1180 },
  { width: 1180, height: 820 },
]) {
  test.describe(`touch tablet ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test('the page header never grows while the page scrolls', async ({ page }) => {
      await denseTasks(page);
      const toolbar = page.locator('.page-toolbar');
      const expandedHeight = (await toolbar.boundingBox())!.height;
      await page.evaluate(() => window.scrollTo(0, 600));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(400);
      // The chrome hook reacts in the next animation frame; then let any header transition end.
      await page.evaluate(() => {
        const { promise, resolve } = Promise.withResolvers<void>();
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        return promise;
      });
      await settle(toolbar);
      expect((await toolbar.boundingBox())!.height).toBeLessThanOrEqual(expandedHeight + 0.5);
    });

    test('the board region reaches down to the status bar without a dock gap', async ({ page }) => {
      await denseTasks(page);
      await page.getByRole('button', { name: 'Board view', exact: true }).click();
      await expect(page.locator(".issues-content[data-view='board']")).toBeVisible();
      await settle(page.locator('.page-toolbar'));
      const statusBar = (await page.locator('.page-statusbar').boundingBox())!;
      const below = viewport.height - (statusBar.y + statusBar.height);
      // Tablets have no dock; only the workspace's own 8px inset may remain below the status bar.
      expect(below).toBeGreaterThanOrEqual(0);
      expect(below).toBeLessThanOrEqual(8.5);
    });
  });
}

test('the header compacting during a downward document scroll leaves the dock collapsed', async ({
  page,
}) => {
  await denseTasks(page);
  const toolbar = page.locator('.page-toolbar');
  const expandedHeight = (await toolbar.boundingBox())!.height;
  await page.evaluate(() => window.scrollTo(0, 420));
  await expect
    .poll(async () => (await toolbar.boundingBox())!.height)
    .toBeLessThan(expandedHeight - 10);
  await settle(toolbar);
  await expect(page.locator('.mobile-navigation-bar')).toHaveAttribute('data-collapsed', 'true');
});

test('anchor jumps and the live-update badge land just below the measured list header', async ({
  page,
}) => {
  let incoming = false;
  await denseTasks(page, () => incoming);
  const toolbar = page.locator('.page-toolbar');
  const expandedHeight = (await toolbar.boundingBox())!.height;
  expect(Math.abs((await scrollPaddingBelowHeader(page, '.page-toolbar')) - 8)).toBeLessThan(1.5);
  await page.evaluate(() => window.scrollTo(0, 420));
  await expect
    .poll(async () => (await toolbar.boundingBox())!.height)
    .toBeLessThan(expandedHeight - 10);
  await settle(toolbar);
  // The ResizeObserver publishes the final height after the last transition frame's layout.
  await expect
    .poll(async () => Math.abs((await scrollPaddingBelowHeader(page, '.page-toolbar')) - 8))
    .toBeLessThan(1.5);
  const target = page.getByTestId('issue-row').nth(20);
  await target.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
  expect(Math.abs((await belowHeader(target, '.page-toolbar')) - 8)).toBeLessThan(1.5);
  incoming = true;
  await page.getByRole('button', { name: 'Task actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Refresh tasks', exact: true }).click();
  await expect(page.getByRole('button', { name: /1 new.*Review updates/ })).toBeVisible();
  const badgeAnchor = page.locator('.feed-update-anchor');
  expect(Math.abs((await belowHeader(badgeAnchor, '.page-toolbar')) - 8)).toBeLessThan(1.5);
});

test('a task page measures the toolbar that appears after loading, so anchor jumps clear it', async ({
  page,
}) => {
  await login(page);
  await page.getByTestId('issue-row').first().locator('.issue-open').click();
  await expect(page).toHaveURL(/\/tasks\/[^/]+/);
  await page.reload();
  const toolbar = page.locator('.issue-detail-toolbar');
  await expect(toolbar).toBeVisible();
  await expect
    .poll(async () => Math.abs((await scrollPaddingBelowHeader(page, '.issue-detail-toolbar')) - 8))
    .toBeLessThan(1.5);
});

test('the comment action stays clear of the dock when scrolled into view, at the page end and with the keyboard open', async ({
  page,
}) => {
  await login(page);
  await page
    .getByTestId('issue-row')
    .filter({ hasText: 'Add a stable CLI output mode' })
    .first()
    .locator('.issue-open')
    .click();
  const composer = page.getByRole('textbox', { name: 'Comment', exact: true });
  const submit = page.getByRole('button', { name: 'Comment', exact: true });
  const dock = page.locator('.mobile-navigation-bar');
  await composer.fill('Visible above the dock');
  await composer.blur();
  await expect(submit).toBeEnabled();
  const clearOfDock = (target: Locator) =>
    target.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const dockTop = document.querySelector('.mobile-navigation-bar')!.getBoundingClientRect().top;
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return box.top >= 0 && box.bottom <= dockTop && Boolean(hit && el.contains(hit));
    });
  await submit.evaluate((el) => el.scrollIntoView({ block: 'end', behavior: 'instant' }));
  expect(await clearOfDock(submit)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  expect(await clearOfDock(page.locator('.detail-properties button:visible').last())).toBe(true);
  await composer.focus();
  await page.evaluate(() => {
    const viewport = window.visualViewport!;
    Object.defineProperty(viewport, 'height', { configurable: true, get: () => innerHeight - 300 });
    viewport.dispatchEvent(new Event('resize'));
  });
  await expect(dock).toHaveAttribute('data-keyboard', 'true');
  await expect(dock).toHaveAttribute('inert', '');
  await settle(dock);
  await submit.evaluate((el) => el.scrollIntoView({ block: 'end', behavior: 'instant' }));
  const hitWhileTyping = await submit.evaluate((el) => {
    const box = el.getBoundingClientRect();
    return el.contains(
      document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2),
    );
  });
  expect(hitWhileTyping).toBe(true);
});

test('task preview actions use one compact keyboard-operable toolbar and leave room for content', async ({
  page,
}, info) => {
  await login(page);
  await page
    .getByRole('button', { name: /^Preview TKT-/ })
    .first()
    .click();
  const preview = page.getByRole('dialog', { name: 'Task preview', exact: true });
  await expect(preview).toBeVisible();
  const toolbar = preview.getByRole('toolbar', { name: 'Task preview actions', exact: true });
  await expect(toolbar).toBeVisible();
  // Measure after the entrance animation, so both buttons come from the same frame.
  await settle(preview);
  expect((await toolbar.boundingBox())!.height).toBeLessThanOrEqual(64);
  const actions = toolbar.locator('button');
  expect(await actions.count()).toBeGreaterThanOrEqual(2);
  const first = (await actions.nth(0).boundingBox())!;
  const second = (await actions.nth(1).boundingBox())!;
  expect(second.x).toBeGreaterThan(first.x);
  expect(Math.abs(second.y - first.y)).toBeLessThan(2);
  await actions.nth(0).focus();
  await page.keyboard.press('ArrowRight');
  await expect(actions.nth(1)).toBeFocused();
  // From the close button, ArrowLeft enters the toolbar at its last action.
  await preview.getByRole('button', { name: 'Close preview', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(actions.last()).toBeFocused();
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('compact-preview-toolbar.png'),
  });
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
});

test('a pending preview action keeps keyboard focus in the toolbar and reports failure there', async ({
  page,
}) => {
  await login(page);
  await page.evaluate(() => {
    let calls = 0;
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: () =>
        new Promise<void>((_, fail) => {
          calls += 1;
          Reflect.set(window, 'copyCalls', calls);
          Reflect.set(window, 'failCopy', () => fail(new Error('Clipboard denied')));
        }),
    });
  });
  await page
    .getByRole('button', { name: /^Preview TKT-/ })
    .first()
    .focus();
  await page.keyboard.press('Enter');
  const preview = page.getByRole('dialog', { name: 'Task preview', exact: true });
  const open = preview.getByRole('button', { name: 'Open task', exact: true });
  const copy = preview.getByRole('button', { name: 'Copy', exact: true });
  await expect(open).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  await expect(copy).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Copy link', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(preview).toHaveAttribute('aria-busy', 'true');
  await expect(copy).toBeDisabled();
  await expect(copy).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, 'copyCalls'))).toBe(1);
  await page.evaluate(() => (Reflect.get(window, 'failCopy') as () => void)());
  await expect(preview.getByRole('alert')).toContainText('could not be confirmed');
  await expect(copy).toBeEnabled();
  await expect(copy).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(preview.getByRole('combobox', { name: /^Assignee: / })).toBeFocused();
});

/** Largest per-channel difference between two same-size PNG screenshots, decoded by the page. */
function maxChannelDifference(page: Page, a: Buffer, b: Buffer) {
  return page.evaluate(
    async (images) => {
      const pixels = await Promise.all(
        images.map(async (base64) => {
          const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
          const bitmap = await createImageBitmap(blob);
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const context = canvas.getContext('2d')!;
          context.drawImage(bitmap, 0, 0);
          return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
        }),
      );
      let max = 0;
      for (let i = 0; i < pixels[0].length; i++)
        if (i % 4 !== 3) max = Math.max(max, Math.abs(pixels[0][i] - pixels[1][i]));
      return max;
    },
    [a.toString('base64'), b.toString('base64')],
  );
}

// 12 of 255 per channel is a contrast ratio of about 1.1:1 against the dark canvas: nothing
// beneath the header reads as text, even where the engine paints no backdrop blur.
const BLEED_THROUGH_LIMIT = 12;

test('the sticky page header keeps settings tabs scrolled beneath it unreadable', async ({
  page,
}, info) => {
  await login(page);
  await page.goto('/settings');
  await page
    .locator('.settings-tabs')
    .getByRole('button', { name: 'Modules', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Only what your team needs.' })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        window.scrollTo(0, 40);
        return window.scrollY;
      }),
    )
    .toBe(40);
  const header = page.locator('.page-toolbar');
  await settle(header);
  const box = (await header.boundingBox())!;
  const tabs = (await page.locator('.settings-tabs').boundingBox())!;
  // The tab labels must really be beneath the header's lower strip, or the check proves nothing.
  expect(tabs.y).toBeLessThan(box.y + box.height - 8);
  expect(tabs.y + tabs.height).toBeGreaterThan(box.y + box.height);
  const clip = { x: 0, y: box.y + box.height - 24, width: box.width, height: 24 };
  const beneath = await page.screenshot({ clip, animations: 'disabled' });
  await page.screenshot({ animations: 'disabled', path: info.outputPath('settings-header.png') });
  await page.addStyleTag({ content: '.settings-tabs { visibility: hidden !important; }' });
  const empty = await page.screenshot({ clip, animations: 'disabled' });
  expect(await maxChannelDifference(page, beneath, empty)).toBeLessThanOrEqual(BLEED_THROUGH_LIMIT);
});
