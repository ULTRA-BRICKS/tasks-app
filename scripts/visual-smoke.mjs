import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.TEST_BASE_URL;
if (!base || !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base))
  throw new Error('Explicit local TEST_BASE_URL required');
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
  colorScheme: 'dark',
});
const failures = [];
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('Failed to load resource'))
    failures.push(m.text());
});
page.on('pageerror', (e) => failures.push(e.message));
await mkdir('test-results/manual', { recursive: true });
try {
  await page.goto(base + '/issues');
  await page.getByLabel('Email', { exact: true }).fill('demo@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-demo-password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('heading', { name: 'All issues', exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/manual/issues.png' });
  await page.getByRole('button', { name: 'New issue', exact: true }).click();
  await page.waitForURL('**/issues/new');
  await page
    .getByRole('textbox', { name: 'Title', exact: true })
    .fill('Fix CSS in payment history');
  await page.locator('.document-description[contenteditable=true]').waitFor();
  await page
    .getByRole('textbox', { name: 'Description', exact: true })
    .fill(
      'Clipping is causing the date/time for transactions to be cut off. Reported on Mobile iOS 14 user.',
    );
  await page.getByRole('textbox', { name: 'Title', exact: true }).click();
  await page.screenshot({ path: 'test-results/manual/new-issue.png' });
  await page.getByRole('button', { name: 'Create issue', exact: true }).click();
  await page.waitForURL(/\/issues\/(?!new)[^/]+$/);
  await page.getByRole('textbox', { name: 'Title', exact: true }).waitFor();
  await page.locator('.document-description').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'test-results/manual/issue-detail.png' });
  const issueUrl = page.url();
  await page
    .getByRole('textbox', { name: 'Title', exact: true })
    .fill('Inline saved without a form');
  await page.getByRole('textbox', { name: 'Title', exact: true }).press('Enter');
  await page.waitForTimeout(500);
  await page.reload();
  await page.getByRole('textbox', { name: 'Title', exact: true }).waitFor();
  if (
    (await page.getByRole('textbox', { name: 'Title', exact: true }).inputValue()) !==
    'Inline saved without a form'
  )
    throw new Error('Inline title did not persist');
  await page.setViewportSize({ width: 393, height: 852 });
  await page.screenshot({ path: 'test-results/manual/issue-mobile.png' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (overflow) throw new Error('Mobile page overflows horizontally');
  await writeFile(
    'test-results/manual/summary.json',
    JSON.stringify({ issueUrl, failures, overflow }, null, 2),
  );
  if (failures.length) throw new Error(failures.join('\n'));
  console.log(
    'Page-first create, rich Markdown, inline title persistence and mobile width passed.',
  );
} catch (e) {
  await page.screenshot({ path: 'test-results/manual/failure.png' });
  await writeFile(
    'test-results/manual/failure.txt',
    String(e) + '\n' + failures.join('\n') + '\n' + (await page.locator('body').innerText()),
  );
  throw e;
} finally {
  await browser.close();
}
