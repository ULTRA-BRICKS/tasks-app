/** UB-36 B5: undo and redo of saved task properties (docs/KEYBOARD-COMMANDS.md). */
import { test, expect } from '@playwright/test';
import { csrf, requests, openWorkspace } from './keyboard-fixture';

test.describe('in the workspace', () => {
  let mod: 'Meta' | 'Control';
  test.beforeEach(async ({ page }) => {
    mod = await openWorkspace(page);
  });

  test('undo: saved property changes undo and redo; native text undo stays in fields', async ({
    page,
    browserName,
  }) => {
    const headers = { Origin: new URL(page.url()).origin, ...csrf };
    const catalog = await (await page.request.get('/api/v1/catalog')).json();
    const created = await page.request.post('/api/v1/issues', {
      headers,
      data: { team_id: catalog.teams[0].id, title: `Undo ${browserName} ${Date.now()}` },
    });
    expect(created.status()).toBe(201);
    const task = await created.json();
    const server = async () =>
      (await (await page.request.get('/api/v1/issues/' + task.id)).json()) as {
        status_id: string;
        status_name: string;
        version: number;
        priority: number;
      };
    const statusName = (id: string) =>
      catalog.statuses.find((s: { id: string; name: string }) => s.id === id).name as string;
    const initial = statusName(task.status_id);
    const target = catalog.statuses.find(
      (s: { team_id: string; id: string; name: string }) =>
        s.team_id === task.team_id && s.id !== task.status_id && s.name !== 'Canceled',
    ).name as string;
    await page.goto('/tasks/' + task.id);
    const status = page.getByRole('combobox', { name: 'Status', exact: true });
    await status.click();
    await page.getByRole('option', { name: target, exact: true }).click();
    await expect(status).toContainText(target);
    await expect.poll(async () => (await server()).status_name).toBe(target);
    // While the picker is still closing, its search field can take focus back from the trigger.
    await expect(page.getByRole('listbox', { name: 'Status' })).toBeHidden();

    // Inside a text field, Mod+Z stays the field's own undo: no domain PATCH.
    const writes = requests(page, 'PATCH', new RegExp(`^/api/v1/issues/${task.id}$`));
    const title = page.getByRole('textbox', { name: 'Title', exact: true });
    await title.focus();
    await page.keyboard.press(`${mod}+z`);
    await page.keyboard.press('Escape');
    expect(writes).toHaveLength(0);
    expect((await server()).status_name).toBe(target);

    // Focus back on the status control: Mod+Z undoes the saved change.
    await status.focus();
    await page.keyboard.press(`${mod}+z`);
    await expect.poll(async () => (await server()).status_name).toBe(initial);
    await expect(page.getByRole('status').filter({ hasText: 'Undid Status' })).toBeVisible();
    await expect(status).toContainText(initial);
    await page.keyboard.press(`${mod}+Shift+z`);
    await expect.poll(async () => (await server()).status_name).toBe(target);
    await expect(status).toContainText(target);
    expect(writes).toHaveLength(2);
  });

  test('undo: one step at a time, and a newer server value is never overwritten', async ({
    page,
    browserName,
  }) => {
    const headers = { Origin: new URL(page.url()).origin, ...csrf };
    const catalog = await (await page.request.get('/api/v1/catalog')).json();
    const created = await page.request.post('/api/v1/issues', {
      headers,
      data: { team_id: catalog.teams[0].id, title: `Undo race ${browserName} ${Date.now()}` },
    });
    const task = await created.json();
    const server = async () =>
      (await (await page.request.get('/api/v1/issues/' + task.id)).json()) as {
        status_id: string;
        status_name: string;
        version: number;
      };
    const choices = catalog.statuses
      .filter((s: { team_id: string; id: string }) => s.team_id === task.team_id)
      .filter((s: { id: string }) => s.id !== task.status_id)
      .map((s: { id: string; name: string }) => s) as { id: string; name: string }[];
    const [first, second, third] = choices;
    await page.goto('/tasks/' + task.id);
    const status = page.getByRole('combobox', { name: 'Status', exact: true });
    for (const next of [first, second]) {
      await status.click();
      await page.getByRole('option', { name: next.name, exact: true }).click();
      await expect.poll(async () => (await server()).status_name).toBe(next.name);
      await expect(page.getByRole('listbox', { name: 'Status' })).toBeHidden();
    }

    // A second Mod+Z while the first is in flight does nothing.
    const writes = requests(page, 'PATCH', new RegExp(`^/api/v1/issues/${task.id}$`));
    await page.route(`**/api/v1/issues/${task.id}`, async (route) => {
      if (route.request().method() === 'PATCH') {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 600);
        await promise;
      }
      await route.continue();
    });
    await status.focus();
    await page.keyboard.press(`${mod}+z`);
    await page.keyboard.press(`${mod}+z`);
    await expect.poll(async () => (await server()).status_name).toBe(first.name);
    await page.waitForTimeout(800);
    expect(writes).toHaveLength(1);
    expect((await server()).status_name).toBe(first.name);

    // Someone else changes the status; redo must not overwrite it.
    const current = await server();
    const concurrent = await page.request.patch('/api/v1/issues/' + task.id, {
      headers,
      data: { version: current.version, status_id: third.id },
    });
    expect(concurrent.status()).toBe(200);
    await status.focus();
    await page.keyboard.press(`${mod}+Shift+z`);
    await expect(
      page.getByRole('alert').filter({ hasText: `Status is now “${third.name}”` }),
    ).toBeVisible();
    expect((await server()).status_name).toBe(third.name);
    expect(writes).toHaveLength(1);
  });
});
