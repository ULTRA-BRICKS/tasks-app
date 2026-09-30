import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { login } from './session-fixture';

// UB-32 (docs/PHONE-OVERFLOW.md): a phone page never drifts sideways, with any content and
// with any popup open. Widths cover iPhone SE through Pro Max.
const WIDTHS = [320, 375, 393, 430];
const personId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const longName = 'Very long person ' + 'LongName'.repeat(16);
const longEmail = 'very.long.person.' + 'x'.repeat(60) + '@example-subdomain.test';
const longUrl = 'https://example.test/' + 'unbroken'.repeat(40);
const table = [
  '| Column one | Column two | Column three | Column four | Column five | Column six |',
  '| --- | --- | --- | --- | --- | --- |',
  '| ' + 'cell'.repeat(20) + ' | b | c | d | e | f |',
].join('\n');
const code = '```\nconst value = "' + 'codeline'.repeat(30) + '";\n```';
const description = [
  '# Heading ' + 'Unbroken'.repeat(12),
  'A long URL: ' + longUrl,
  '',
  'Inline `' + 'inlinecode'.repeat(20) + '` here.',
  '',
  code,
  '',
  table,
  '',
  ...Array.from({ length: 40 }, (_, i) => `Line ${i + 1} of a long task body.`),
].join('\n');
const PICKERS = ['Status', 'Priority', 'Assignee', 'Labels', 'Project', 'Cycle', 'Estimate'];
const CALENDARS = ['Start date', 'Due date'];
// Real phone viewports for the in-place Estimate check: iPhone SE, mini, 14 and Pro Max.
const PHONES = [
  [320, 568],
  [375, 667],
  [390, 844],
  [430, 932],
] as const;

// Real overflow sources must be measured, so any root-level clipping is switched off first.
const UNMASK = 'html, body { overflow-x: visible !important; }';

async function phone(browser: Browser, width: number, height = 760, { longTask = true } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    hasTouch: true,
    isMobile: true,
  });
  await context.addInitScript((css) => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = css;
      document.head.append(style);
    });
  }, UNMASK);
  const page = await context.newPage();
  if (!longTask) return { context, page };
  await page.route('**/api/v1/catalog', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.source_people = [
      ...(data.source_people ?? []),
      {
        id: personId,
        name: longName,
        email: longEmail,
        avatar_url: null,
        provider: 'linear',
        source_id: 'long-person',
      },
    ];
    await route.fulfill({ response, json: data });
  });
  await page.route(/\/api\/v1\/issues\/[a-f0-9-]+$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      response,
      json: {
        ...data,
        title: 'Long title ' + 'Unbrokentitle'.repeat(10),
        assignee_id: personId,
        start_date: '2026-09-10',
        due_date: '2026-10-31',
        description,
        links: [{ id: 'link-long', url: longUrl, title: longUrl, provider: 'web' }],
        comments: [
          {
            id: 'comment-long',
            author_id: personId,
            author_name: longName,
            body: `See ${longUrl}\n\n${code}\n\n${table}`,
            created_at: data.created_at,
            updated_at: data.created_at,
            version: 1,
          },
          {
            // An imported author the directory does not know: the stored name, without a card.
            id: 'comment-unknown-author',
            author_id: 'unknown-long-author',
            author_name: 'Imported' + 'Unbrokenauthor'.repeat(8),
            body: 'Imported comment.',
            created_at: data.created_at,
            updated_at: data.created_at,
            version: 1,
          },
        ],
        activity: [
          {
            id: 'activity-long',
            // An ID the directory does not know keeps the stored name as plain text.
            actor_id: 'unknown-long-actor',
            actor_name: longName,
            action: 'updated',
            summary: 'updated the task',
            changes: [
              { kind: 'value', field: 'title', label: 'Title', from: longUrl, to: 'Short' },
            ],
            data: {},
            created_at: data.created_at,
          },
          ...data.activity,
        ],
      },
    });
  });
  return { context, page };
}

async function openLongTask(page: Page) {
  await login(page);
  await page.locator('.issue-open').first().click();
  await expect(page.getByRole('textbox', { name: 'Description' })).toContainText('Line 40');
}

/** Root overflow, scroll offset and zoom, then an explicit sideways scroll that must not move. */
async function expectNoDrift(page: Page, step: string) {
  const state = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollX,
    pageLeft: visualViewport!.pageLeft,
    scale: visualViewport!.scale,
  }));
  expect(state, step).toMatchObject({ scrollX: 0, pageLeft: 0, scale: 1 });
  expect(state.scrollWidth, `${step}: ${JSON.stringify(state)}`).toBeLessThanOrEqual(
    state.clientWidth + 1,
  );
  const forced = await page.evaluate(() => {
    scrollTo({ left: 200, top: scrollY });
    return { scrollX, pageLeft: visualViewport!.pageLeft };
  });
  expect(forced, `${step}: sideways scroll`).toEqual({ scrollX: 0, pageLeft: 0 });
}

/**
 * A popup lies inside the visual viewport minus the given safe-area insets and, unless it is
 * drawn over the dock itself (the task preview), above the phone dock: a popup reaching into
 * the dock hides its last options behind the navigation.
 */
async function expectInside(
  popup: Locator,
  step: string,
  { inset = { top: 0, bottom: 0 }, clearOfDock = true } = {},
) {
  await expect(popup, step).toBeVisible();
  const box = await popup.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const dock = document.querySelector('.mobile-dock')?.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: document.documentElement.clientWidth,
      height: Math.min(innerHeight, visualViewport!.offsetTop + visualViewport!.height),
      dockTop: dock && dock.height > 0 ? dock.top : Infinity,
    };
  });
  const message = `${step}: ${JSON.stringify({ ...box, inset })}`;
  expect(box.left, message).toBeGreaterThanOrEqual(0);
  expect(box.right, message).toBeLessThanOrEqual(box.width);
  expect(box.top, message).toBeGreaterThanOrEqual(inset.top);
  expect(box.bottom, message).toBeLessThanOrEqual(box.height - inset.bottom);
  if (clearOfDock)
    expect(box.bottom, `${message}: clear of the dock`).toBeLessThanOrEqual(box.dockTop);
}

const pickerPopup = (page: Page, name: string) =>
  page.locator('.picker-popup').filter({ has: page.getByRole('listbox', { name, exact: true }) });

for (const width of WIDTHS) {
  test(`long task details never drift sideways while scrolling or focusing at ${width}px`, async ({
    browser,
  }) => {
    const { context, page } = await phone(browser, width);
    try {
      await openLongTask(page);
      for (const [step, position] of [
        ['top', 0],
        ['middle', 0.5],
        ['bottom', 1],
      ] as const) {
        await page.evaluate(
          (at) => scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * at),
          position,
        );
        await expectNoDrift(page, `scrolled to the ${step}`);
      }
      // Nothing is hidden by clipping: every element of the task lies inside the viewport
      // unless it sits in an explicit horizontal scroller (table, activity diff).
      const outside = await page.locator('.issue-detail-panel').evaluate((panel) => {
        const width = document.documentElement.clientWidth;
        return [...panel.querySelectorAll('*')]
          .filter((el) => {
            if (el.parentElement?.closest('.tableWrapper, .activity-diff')) return false;
            const box = el.getBoundingClientRect();
            return box.width > 1 && box.height > 1 && (box.left < -1 || box.right > width + 1);
          })
          .map((el) => `${el.tagName.toLowerCase()}.${el.className}`)
          .slice(0, 5);
      });
      expect(outside).toEqual([]);
      // Tables (description editor and read-only comment) scroll inside their own region;
      // code wraps rather than hiding text.
      const regions = await page.locator('.issue-detail-panel').evaluate((panel) =>
        ['.document-description', '.comment .markdown'].map((selector) => {
          const markdown = panel.querySelector(selector)!;
          const wrapper = markdown.querySelector<HTMLElement>('.tableWrapper')!;
          const start = wrapper.scrollLeft;
          wrapper.scrollLeft = 10_000;
          const pre = markdown.querySelector('pre')!;
          return {
            selector,
            table: getComputedStyle(wrapper).overflowX,
            tableScrolls: wrapper.scrollLeft > start,
            codeHidden: pre.scrollWidth > pre.clientWidth + 1,
          };
        }),
      );
      expect(regions).toEqual([
        {
          selector: '.document-description',
          table: 'auto',
          tableScrolls: true,
          codeHidden: false,
        },
        { selector: '.comment .markdown', table: 'auto', tableScrolls: true, codeHidden: false },
      ]);
      await page.evaluate(() => scrollTo(0, 0));
      for (const [step, field] of [
        ['title', page.getByRole('textbox', { name: 'Title', exact: true })],
        ['description', page.getByRole('textbox', { name: 'Description' })],
        ['comment', page.getByRole('textbox', { name: 'Comment', exact: true })],
        ...CALENDARS.map(
          (name) => [name, page.getByRole('textbox', { name, exact: true })] as const,
        ),
      ] as const) {
        await field.scrollIntoViewIfNeeded();
        await field.click();
        await expect(field).toBeFocused();
        await expectNoDrift(page, `focused ${step}`);
        await field.blur();
      }
      // Pinch zoom stays available: no zoom cap and no root gesture restriction.
      const zoom = await page.evaluate(() => ({
        meta: document.querySelector('meta[name="viewport"]')!.getAttribute('content'),
        html: getComputedStyle(document.documentElement).touchAction,
        body: getComputedStyle(document.body).touchAction,
      }));
      expect(zoom.meta).not.toMatch(/maximum-scale|user-scalable\s*=\s*(no|0)/i);
      expect(['auto', 'manipulation']).toContain(zoom.html);
      expect(['auto', 'manipulation']).toContain(zoom.body);
    } finally {
      await context.close();
    }
  });

  test(`popups stay inside the viewport without page drift at ${width}px`, async ({ browser }) => {
    const { context, page } = await phone(browser, width);
    try {
      await openLongTask(page);
      for (const name of PICKERS) {
        const trigger = page.getByRole('combobox', { name, exact: true });
        await trigger.scrollIntoViewIfNeeded();
        await trigger.click();
        await expectInside(pickerPopup(page, name), name);
        await expectNoDrift(page, `${name} open`);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('listbox', { name, exact: true })).toHaveCount(0);
      }
      for (const name of CALENDARS) {
        const open = page.getByRole('button', {
          name: `Open ${name.toLowerCase()} calendar`,
          exact: true,
        });
        await open.scrollIntoViewIfNeeded();
        await open.click();
        const calendar = page.getByRole('dialog', { name: `${name} calendar`, exact: true });
        await expectInside(calendar, `${name} calendar`);
        await expectNoDrift(page, `${name} calendar open`);
        await page.keyboard.press('Escape');
        await expect(calendar).toHaveCount(0);
      }
      // The cycle hint beside the Cycle picker.
      const cycleHelp = page.getByRole('button', { name: 'About cycles', exact: true });
      await cycleHelp.scrollIntoViewIfNeeded();
      await cycleHelp.click();
      const hint = page.getByRole('dialog', { name: 'What is a cycle?', exact: true });
      await expectInside(hint, 'cycle help');
      await expectNoDrift(page, 'cycle help open');
      await page.keyboard.press('Escape');
      await expect(hint).toHaveCount(0);
      await page.evaluate(() => scrollTo(0, 0));
      await page.getByRole('button', { name: 'Task actions', exact: true }).click();
      await expectInside(page.getByRole('menu', { name: 'Task actions' }), 'task actions menu');
      await expectNoDrift(page, 'task actions menu open');
      // The Copy submenu opens beside a trigger that spans the phone's width.
      await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();
      const copyMenu = page.getByRole('menu', { name: 'Copy', exact: true });
      await expectInside(copyMenu, 'copy submenu');
      await expectNoDrift(page, 'copy submenu open');
      await page.keyboard.press('Escape');
      await expect(copyMenu).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(0);
      // The person card of the long-named comment author.
      const author = page.locator('.comment > header').getByRole('button', { name: longName });
      await author.scrollIntoViewIfNeeded();
      await author.tap();
      const card = page.getByRole('dialog', { name: longName, exact: true });
      await expectInside(card, 'person card');
      await expectNoDrift(page, 'person card open');
      await page.keyboard.press('Escape');
      await expect(card).toHaveCount(0);
      // List surfaces: a Select picker holding the long person, and the task preview.
      await page.getByRole('button', { name: 'Close task', exact: true }).click();
      await page.getByRole('button', { name: 'Filter', exact: true }).click();
      const assigneeFilter = page.getByRole('combobox', { name: 'Filter by assignee' });
      await assigneeFilter.click();
      await expectInside(pickerPopup(page, 'Filter by assignee'), 'assignee filter');
      await expectNoDrift(page, 'assignee filter open');
      await page.keyboard.press('Escape');
      await page
        .getByRole('button', { name: /^Preview / })
        .first()
        .click();
      const preview = page.getByRole('dialog', { name: 'Task preview' });
      // The preview is drawn over the dock (UB-38 owns its phone placement).
      await expectInside(preview, 'task preview', { clearOfDock: false });
      await expectNoDrift(page, 'task preview open');
      await page.keyboard.press('Escape');
      await expect(preview).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
}

// Estimate ticket 9aaaf79e (WebKit phone): the description editor chunk arrived after the task
// had rendered, so the properties below jumped 256px and the Estimate trigger left the screen
// with its popup opening under the dock. A held chunk reproduces a slow phone network.
declare global {
  interface Window {
    /** Distinct offsets of the Estimate trigger inside the task layout, one per change. */
    estimateOffsets?: number[];
  }
}
/** Two animation frames: long enough for per-frame samplers and settled layout. */
const twoFrames = (page: Page) =>
  page.evaluate(() => {
    const { promise, resolve } = Promise.withResolvers<void>();
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    return promise;
  });
for (const [width, height] of PHONES) {
  test(`the Estimate picker opens in place above the dock at ${width}x${height}`, async ({
    browser,
  }) => {
    const { context, page } = await phone(browser, width, height, { longTask: false });
    try {
      const chunk = Promise.withResolvers<void>();
      await page.route(/\/rich-description/, async (route) => {
        await chunk.promise;
        await route.continue();
      });
      // Every frame, where the Estimate trigger sits inside the task layout. The page header's
      // own compaction moves the whole layout and is not a content shift, so it is excluded.
      await page.addInitScript(() => {
        const offsets: number[] = [];
        window.estimateOffsets = offsets;
        const sample = () => {
          const trigger = document.querySelector('[role="combobox"][aria-label="Estimate"]');
          const layout = trigger?.closest('.detail-layout');
          if (trigger && layout && trigger.getBoundingClientRect().height > 0) {
            const offset = Math.round(
              trigger.getBoundingClientRect().top - layout.getBoundingClientRect().top,
            );
            if (offsets.at(-1) !== offset) offsets.push(offset);
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      await login(page);
      await page.locator('.issue-open').first().click();
      await expect(page.getByRole('region', { name: 'Task details' })).toBeVisible();
      // Let the sampler see whatever rendered before the editor chunk arrives.
      await twoFrames(page);
      chunk.resolve();
      await expect(page.getByRole('textbox', { name: 'Description' })).toBeVisible();
      const trigger = page.getByRole('combobox', { name: 'Estimate', exact: true });
      await expect(trigger).toBeVisible();
      await twoFrames(page);
      const offsets = await page.evaluate(() => window.estimateOffsets);
      expect(offsets, 'the Estimate trigger never moves inside the task layout').toHaveLength(1);

      // Just above the dock, where the popup must open upwards; then mid-screen, where opening
      // downwards would reach the dock.
      for (const [step, place] of [
        ['above the dock', 'dock'],
        ['mid-screen', 'middle'],
      ] as const) {
        await trigger.evaluate((el, at) => {
          const dock = document.querySelector('.mobile-dock')!.getBoundingClientRect();
          const box = el.getBoundingClientRect();
          const target = at === 'dock' ? dock.top - 8 - box.height : innerHeight / 2 - box.height;
          scrollTo(0, scrollY + box.top - target);
        }, place);
        // The dock and header settle after a scroll (collapse, compaction).
        await page.waitForTimeout(400);
        const before = await trigger.evaluate((el) => ({
          top: Math.round(el.getBoundingClientRect().top),
          scrollX,
          scrollY: Math.round(scrollY),
        }));
        // A finger tap where the trigger is. Locator.tap() would first scroll the trigger out of
        // the dock's scroll-padding band, which a real touch never does.
        const box = (await trigger.boundingBox())!;
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        const popup = pickerPopup(page, 'Estimate');
        await expectInside(popup, `Estimate ${step}`);
        const after = await trigger.evaluate((el) => ({
          top: Math.round(el.getBoundingClientRect().top),
          scrollX,
          scrollY: Math.round(scrollY),
        }));
        expect(after, `Estimate ${step}: the trigger and the page stay put`).toEqual(before);
        // The last option is reachable inside the popup, not hidden under the dock.
        const last = popup.getByRole('option').last();
        await last.scrollIntoViewIfNeeded();
        await expectInside(last, `Estimate ${step}: last option`);
        await page.keyboard.press('Escape');
        await expect(popup).toHaveCount(0);
      }
    } finally {
      await context.close();
    }
  });
}

test('popups respect the notch and home-indicator safe areas', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'Only Chromium can emulate safe-area insets (CDP).');
  const inset = { top: 47, bottom: 34 };
  const { context, page } = await phone(browser, 390, 600);
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', {
      insets: { top: inset.top, topMax: inset.top, bottom: inset.bottom, bottomMax: inset.bottom },
    });
    await openLongTask(page);
    // Centred triggers leave too little room on either side, so each popup meets an edge.
    for (const name of ['Status', 'Assignee', 'Labels']) {
      const trigger = page.getByRole('combobox', { name, exact: true });
      await trigger.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await trigger.click();
      await expectInside(pickerPopup(page, name), name, { inset });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('listbox', { name, exact: true })).toHaveCount(0);
    }
    for (const name of CALENDARS) {
      const open = page.getByRole('button', {
        name: `Open ${name.toLowerCase()} calendar`,
        exact: true,
      });
      await open.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await open.click();
      const calendar = page.getByRole('dialog', { name: `${name} calendar`, exact: true });
      await expectInside(calendar, `${name} calendar`, { inset });
      await page.keyboard.press('Escape');
      await expect(calendar).toHaveCount(0);
    }
  } finally {
    await context.close();
  }
});
