import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { writeFileSync } from 'node:fs';
let cookies: Awaited<ReturnType<BrowserContext['cookies']>> | undefined;
async function login(page: Page) {
  if (cookies) {
    await page.context().addCookies(cookies);
    await page.goto('/issues');
  } else {
    await page.goto('/issues');
    await page.getByLabel('Email', { exact: true }).fill('demo@example.test');
    await page.getByLabel('Password', { exact: true }).fill('local-demo-password');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'All issues', exact: true })).toBeVisible();
    cookies = await page.context().cookies();
  }
  await expect(page.getByRole('heading', { name: 'All issues', exact: true })).toBeVisible();
}
for (const bytes of [100, 10000, 50000])
  test(`document-state benchmark with ${bytes} description characters`, async ({ page }, info) => {
    const backend = process.env.VITE_STATE_BACKEND === 'baseline' ? 'baseline' : 'state-lib',
      errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await login(page);
    await page.getByRole('button', { name: 'New issue', exact: true }).click();
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill(`Benchmark ${bytes}`);
    await page.getByRole('textbox', { name: 'Description', exact: true }).fill('x'.repeat(bytes));
    await page.getByRole('button', { name: 'Create issue', exact: true }).click();
    await expect(page).toHaveURL(/\/issues\/(?!new)[^/]+$/);
    await expect(page.locator('html')).toHaveAttribute('data-document-backend', backend);
    const issueId = new URL(page.url()).pathname.split('/').at(-1)!;
    const title = page.getByRole('textbox', { name: 'Title', exact: true });
    await title.focus();
    const observations = await page.evaluate(
      async ({ issueId, bytes }) => {
        const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
          'input[aria-label="Title"],textarea[aria-label="Title"]',
        );
        if (!input) throw Error('Actual issue editor title not found');
        const setValue = Object.getOwnPropertyDescriptor(
          input instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype,
          'value',
        )!.set!.bind(input);
        const samples: { handlerMs: number; nextFrameMs: number }[] = [];
        for (let i = -5; i < 40; i++) {
          const value = `Bench ${bytes} operation ${i}`,
            started = performance.now();
          setValue(value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          const handlerMs = performance.now() - started;
          await new Promise(requestAnimationFrame);
          const nextFrameMs = performance.now() - started;
          const key = Array.from({ length: sessionStorage.length }, (_, index) =>
            sessionStorage.key(index)!,
          ).find((key) => key.startsWith('ticket-draft:') && key.endsWith(':' + issueId));
          if (!key || JSON.parse(sessionStorage.getItem(key)!).title !== value)
            throw Error('The real document store did not persist the measured input');
          if (i >= 0) samples.push({ handlerMs, nextFrameMs });
        }
        return samples;
      },
      { issueId, bytes },
    );
    const committed = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/issues/' + issueId) &&
        response.request().method() === 'PATCH' &&
        response.status() === 200,
    );
    await title.blur();
    await committed;
    const finalTitle = `Bench ${bytes} operation 39`;
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(finalTitle);
    let usedJSHeapBytes: number | null = null;
    if (info.project.name === 'chromium') {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('HeapProfiler.collectGarbage');
      const memory = await cdp.send('Runtime.getHeapUsage');
      usedJSHeapBytes = memory.usedSize;
      await cdp.detach();
    }
    const quantile = (values: number[], q: number) =>
      [...values].sort((a, b) => a - b)[
        Math.min(values.length - 1, Math.ceil(values.length * q) - 1)
      ];
    const result = {
      backend,
      descriptionCharacters: bytes,
      browser: info.project.name,
      eventSamples: observations.length,
      handlerMedianMs: quantile(
        observations.map((x) => x.handlerMs),
        0.5,
      ),
      handlerP95Ms: quantile(
        observations.map((x) => x.handlerMs),
        0.95,
      ),
      nextFrameMedianMs: quantile(
        observations.map((x) => x.nextFrameMs),
        0.5,
      ),
      nextFrameP95Ms: quantile(
        observations.map((x) => x.nextFrameMs),
        0.95,
      ),
      usedJSHeapBytes,
      observations,
      notes: [
        'Five warmup inputs; forty recorded native input events through the real React editor.',
        'Each sample checks that the real sessionStorage draft changed, then saves/reloads through the synthetic API.',
        'Next frame is a lab metric, not field INP. One heap snapshot is not a statistically robust memory comparison.',
      ],
    };
    writeFileSync(info.outputPath('metrics.json'), JSON.stringify(result, null, 2) + '\n');
    console.info(JSON.stringify({ ...result, observations: undefined }));
    expect(errors).toEqual([]);
  });
