import { expect, type Page, type BrowserContext } from '@playwright/test';
import { detectPlatform } from '../../src/shared/lib/commands';
let session: Awaited<ReturnType<BrowserContext['cookies']>> | undefined;
/**
 * The page's command modifier (⌘ on a Mac, Ctrl elsewhere). The app reads the platform the
 * browser reports, and device emulation reports its own (Desktop Chrome says Windows), so
 * Playwright's host-based `ControlOrMeta` can press the wrong key.
 */
export async function commandModifier(page: Page): Promise<'Meta' | 'Control'> {
  const reported = await page.evaluate(() => {
    const nav: Navigator & { userAgentData?: { platform?: string } } = navigator;
    return {
      platform: nav.platform,
      userAgent: nav.userAgent,
      userAgentData: { platform: nav.userAgentData?.platform },
    };
  });
  return detectPlatform(reported) === 'mac' ? 'Meta' : 'Control';
}
/** Reuse the synthetic fixture's login, without disabling the real authentication rate limiter. */
export async function login(page: Page) {
  if (session) {
    await page.context().addCookies(session);
    const me = await page.request.get('/api/v1/me');
    if (me.ok()) {
      await page.goto('/issues');
      await expect(page.getByTestId('issue-row').first()).toBeVisible();
      return;
    }
    session = undefined;
    await page.context().clearCookies();
  }
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('demo@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-demo-password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByTestId('issue-row').first()).toBeVisible();
  session = await page.context().cookies();
}
/** Longer than the 340 ms hold threshold (HOLD_DELAY in src/shared/lib/press-hold.ts). */
export const PAST_HOLD_MS = 450;
/** Replaces the page's clipboard; each write lands in `document.documentElement.dataset.copied`. */
export function stubClipboard(page: Page) {
  return page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          document.documentElement.dataset.copied = text;
        },
      },
    }),
  );
}
