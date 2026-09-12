import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const base = process.env.TEST_BASE_URL;
if (!base || !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base))
  throw new Error('Provide TEST_BASE_URL of the isolated local demo test server, not production.');
const output = 'docs/screenshots/parity',
  temporary = 'test-results/reference-audit';
const title = 'Fix CSS in payment history';
const description =
  'Clipping is causing the date/time for transactions to be cut off. Reported on Mobile iOS 14 user.';
const reference = 'https://linear.app/demo/issue/ENG-128/fix-css-in-payment-history';
const viewport = { width: 1440, height: 1000 };
const options = {
  viewport,
  deviceScaleFactor: 1,
  colorScheme: 'dark',
  locale: 'en-US',
  timezoneId: 'UTC',
  reducedMotion: 'reduce',
};
await mkdir(output, { recursive: true });
await mkdir(temporary, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext(options),
  page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const manifest = {
  sourceCommit: Bun.spawnSync(['git', 'rev-parse', 'HEAD']).stdout.toString().trim(),
  capturedAt: new Date().toISOString(),
  browser: browser.version(),
  platform: process.platform,
  reference,
  ...options,
  alignment: 'Native viewport coordinates; no scaling, translation, warping or pixel exclusions.',
  overlayOpacity: 0.5,
  documentRegion: [244, 80, 990, 240],
  limitations: [
    'System font differs from Linear Inter Variable.',
    'Different navigation modules, identifiers, avatars, activity and property values.',
    'New issue deliberately uses a full document page, not the public demo modal.',
    'No aggregate similarity percentage or native-mobile parity is claimed.',
  ],
  captures: {},
};
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function capture(name) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: output + '/' + name + '.png', animations: 'disabled' });
  manifest.captures[name] = sha(await readFile(output + '/' + name + '.png'));
}
try {
  const refPage = await context.newPage();
  await refPage.goto(reference, { waitUntil: 'domcontentloaded' });
  await refPage.getByText(title, { exact: true }).first().waitFor({ timeout: 60000 });
  await refPage.evaluate(() => document.fonts.ready);
  await refPage.screenshot({ path: temporary + '/linear-detail.png', animations: 'disabled' });
  manifest.referenceHash = sha(await readFile(temporary + '/linear-detail.png'));
  manifest.referenceGeometry = await refPage
    .locator('[contenteditable=true]')
    .evaluateAll((elements) =>
      elements.map((e) => {
        const r = e.getBoundingClientRect(),
          s = getComputedStyle(e);
        return {
          text: e.textContent?.slice(0, 200),
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          fontFamily: s.fontFamily,
          fontSize: s.fontSize,
          lineHeight: s.lineHeight,
          padding: s.padding,
        };
      }),
    );
  await page.goto(base + '/issues');
  await page.getByLabel('Email', { exact: true }).fill('demo@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-demo-password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('heading', { name: 'All issues', exact: true }).waitFor();
  await page.getByTestId('issue-row').first().waitFor();
  await capture('issues');
  await page.getByRole('button', { name: 'Board view', exact: true }).click();
  await page.locator('.issue-card').first().waitFor();
  await capture('board');
  await page.getByRole('button', { name: 'New issue', exact: true }).click();
  await page.waitForURL('**/issues/new');
  await page.locator('.document-description[contenteditable=true]').waitFor();
  await capture('new-issue-empty');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill(description);
  await page.locator('.issue-detail-toolbar').click({ position: { x: 200, y: 15 } });
  await capture('new-issue');
  await page.getByRole('button', { name: 'Create issue', exact: true }).click();
  await page.waitForURL(/\/issues\/(?!new)[^/]+$/);
  await page.locator('.document-description[contenteditable=true]').waitFor();
  await page.locator('.document-description').getByText(description, { exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await capture('issue-detail');
  manifest.appGeometry = await page
    .locator('.document-title,.document-description,.detail-properties,.workspace-main')
    .evaluateAll((elements) =>
      elements.map((e) => {
        const r = e.getBoundingClientRect(),
          s = getComputedStyle(e);
        return {
          className: e.className,
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          textX: r.x + parseFloat(s.paddingLeft) + parseFloat(s.borderLeftWidth),
          fontFamily: s.fontFamily,
          fontSize: s.fontSize,
          lineHeight: s.lineHeight,
          padding: s.padding,
        };
      }),
    );
  const refBytes = await readFile(temporary + '/linear-detail.png'),
    appBytes = await readFile(output + '/issue-detail.png');
  const composite = await page.evaluate(
    async ({ a, b }) => {
      const load = (src) =>
        new Promise((resolve, reject) => {
          const i = new Image();
          i.onload = () => resolve(i);
          i.onerror = reject;
          i.src = src;
        });
      const [ref, app] = await Promise.all([load(a), load(b)]);
      if (
        ref.width !== 1440 ||
        ref.height !== 1000 ||
        app.width !== ref.width ||
        app.height !== ref.height
      )
        throw new Error('Screenshot dimensions differ; refusing alignment by rescaling.');
      const canvas = document.createElement('canvas');
      canvas.width = ref.width;
      canvas.height = ref.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(ref, 0, 0);
      const r = ctx.getImageData(0, 0, ref.width, ref.height);
      ctx.drawImage(app, 0, 0);
      const current = ctx.getImageData(0, 0, ref.width, ref.height),
        blend = ctx.createImageData(ref.width, ref.height),
        diff = ctx.createImageData(ref.width, ref.height);
      for (let i = 0; i < r.data.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          blend.data[i + c] = Math.round((r.data[i + c] + current.data[i + c]) / 2);
          diff.data[i + c] = Math.min(255, Math.abs(r.data[i + c] - current.data[i + c]) * 4);
        }
        blend.data[i + 3] = diff.data[i + 3] = 255;
      }
      ctx.putImageData(blend, 0, 0);
      const full = canvas.toDataURL('image/png');
      const crop = document.createElement('canvas');
      crop.width = 746;
      crop.height = 160;
      const cropped = crop.getContext('2d');
      cropped.drawImage(canvas, 244, 80, 746, 160, 0, 0, 746, 160);
      const region = crop.toDataURL('image/png');
      ctx.putImageData(diff, 0, 0);
      cropped.clearRect(0, 0, 746, 160);
      cropped.drawImage(canvas, 244, 80, 746, 160, 0, 0, 746, 160);
      return { full, region, diff: crop.toDataURL('image/png') };
    },
    {
      a: 'data:image/png;base64,' + refBytes.toString('base64'),
      b: 'data:image/png;base64,' + appBytes.toString('base64'),
    },
  );
  for (const [key, name] of [
    ['full', 'issue-detail-overlay'],
    ['region', 'document-overlay'],
    ['diff', 'document-diff-x4'],
  ]) {
    const bytes = Buffer.from(composite[key].split(',')[1], 'base64');
    await writeFile(output + '/' + name + '.png', bytes);
    manifest.captures[name] = sha(bytes);
  }
  await page.setViewportSize({ width: 393, height: 852 });
  await capture('issue-mobile');
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
    throw new Error('Mobile document overflows');
  await page.setViewportSize(viewport);
  await page.goto(base + '/projects/new');
  await page.locator('.document-description[contenteditable=true]').waitFor();
  await capture('new-project');
  await page.goto(base + '/cycles/new');
  await page.getByRole('textbox', { name: 'Title', exact: true }).waitFor();
  await capture('new-cycle');
  await writeFile(output + '/provenance.json', JSON.stringify(manifest, null, 2) + '\n');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(
    'Captured current React screens, native-coordinate 50% overlay and 4× difference. No global match score claimed.',
  );
  console.log(
    JSON.stringify(
      {
        source: manifest.sourceCommit,
        referenceGeometry: manifest.referenceGeometry,
        appGeometry: manifest.appGeometry,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
