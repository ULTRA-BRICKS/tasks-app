import { test, expect } from '@playwright/test';

test('large Markdown drafts stay editable and are retained after a reload', async ({
  page,
}, info) => {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('demo@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-demo-password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByTestId('issue-row').first()).toBeVisible();
  const source = '<!-- preserve source -->\n' + 'Synthetic paragraph.\n'.repeat(5690);
  const created = await page.request.post('/api/v1/documents', {
    headers: { 'x-tickets-csrf': '1' },
    data: { title: 'Large draft fixture ' + info.project.name, body: source },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  await page.goto('/documents/' + id);
  const field = page.locator('textarea.document-source');
  await expect(field).toHaveValue(source);
  await field.focus();
  const durations: number[] = [];
  for (const character of ['1', '2', '3', '4', '5']) {
    const start = Date.now();
    await field.press('ControlOrMeta+End');
    await page.keyboard.insertText(character);
    durations.push(Date.now() - start);
  }
  const expected = await field.inputValue();
  expect(expected.length).toBe(source.length + 5);
  await page.reload();
  await expect(page.locator('textarea.document-source')).toHaveValue(expected);
  await info.attach('large-draft-input.json', {
    body: JSON.stringify({
      characters: source.length,
      driverRoundtripMs: durations,
      engine: info.project.name,
    }),
    contentType: 'application/json',
  });
});
