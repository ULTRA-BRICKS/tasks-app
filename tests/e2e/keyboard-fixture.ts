/**
 * Helpers shared by the UB-36 keyboard specs (docs/KEYBOARD-COMMANDS.md): a platform override,
 * request capture and task-list selectors.
 */
import type { Page, Request } from '@playwright/test';
import { commandModifier, login } from './session-fixture';

export type Platform = 'mac' | 'windows';
export const csrf = { 'x-tickets-csrf': '1' };
export const modifier = (platform: Platform) => (platform === 'mac' ? 'Meta' : 'Control');

/** The app reads the platform once per load, so the override must run before its scripts. */
export async function usePlatform(page: Page, platform: Platform) {
  await page.addInitScript((mac: boolean) => {
    Object.defineProperty(Navigator.prototype, 'platform', {
      configurable: true,
      get: () => (mac ? 'MacIntel' : 'Win32'),
    });
    Object.defineProperty(Navigator.prototype, 'userAgentData', {
      configurable: true,
      get: () => ({ platform: mac ? 'macOS' : 'Windows', mobile: false, brands: [] }),
    });
  }, platform === 'mac');
}
export function requests(page: Page, method: 'PATCH' | 'POST', path: RegExp) {
  const sent: Request[] = [];
  page.on('request', (request) => {
    if (request.method() === method && path.test(new URL(request.url()).pathname))
      sent.push(request);
  });
  return sent;
}
export const rows = (page: Page) => page.locator('.issue-list [data-testid="issue-row"]');
export const selectedCount = (page: Page) => page.locator('.bulk-toolbar strong');
export async function selectedFlags(page: Page) {
  return rows(page).evaluateAll((all) =>
    all.map((row) => row.querySelector<HTMLInputElement>('.issue-checkbox')?.checked ?? false),
  );
}
export async function blur(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}
export function helpRow(page: Page, title: string) {
  return page
    .getByRole('dialog', { name: 'Keyboard shortcuts' })
    .getByRole('listitem')
    .filter({ has: page.getByText(title, { exact: true }) });
}
/**
 * Signs in and returns the command modifier of the device the browser emulates, which the app
 * reads instead of the host's.
 */
export async function openWorkspace(page: Page) {
  await login(page);
  return commandModifier(page);
}
