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
  // The comment used to switch the body to a source textarea; it is now a read-only element.
  const field = page.getByRole('textbox', { name: 'Description', exact: true });
  await expect(field).toHaveAttribute('contenteditable', 'true');
  await expect(field.getByText('<!-- preserve source -->', { exact: true })).toBeVisible();
  const paragraph = field.locator('p').last();
  await paragraph.click({ position: { x: 4, y: 4 } });
  // Caret after the last character; platform End-key bindings differ inside contenteditable.
  await paragraph.evaluate(async (element) => {
    // The editor reads the DOM selection on `selectionchange`, which fires asynchronously.
    const changed = Promise.withResolvers<void>();
    document.addEventListener('selectionchange', () => changed.resolve(), { once: true });
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
    await changed.promise;
  });
  const durations: number[] = [];
  for (const character of ['1', '2', '3', '4', '5']) {
    const start = Date.now();
    await page.keyboard.insertText(character);
    durations.push(Date.now() - start);
  }
  await expect(field).toContainText('Synthetic paragraph.12345');
  await page.reload();
  const restored = page.getByRole('textbox', { name: 'Description', exact: true });
  await expect(restored).toContainText('Synthetic paragraph.12345');
  await expect(restored.getByText('<!-- preserve source -->', { exact: true })).toBeVisible();
  await info.attach('large-draft-input.json', {
    body: JSON.stringify({
      characters: source.length,
      driverRoundtripMs: durations,
      engine: info.project.name,
    }),
    contentType: 'application/json',
  });
});
