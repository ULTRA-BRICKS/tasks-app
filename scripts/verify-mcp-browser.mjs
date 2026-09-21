import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { fixture } from '../tests/unit/helpers.mjs';
import { withMcp } from '../packages/mcp/handler.mjs';
const port = 9783,
  origin = 'http://localhost:' + port;
const f = await fixture({ APP_URL: origin });
const app = withMcp(f.app, { db: f.db, env: f.env });
const server = Bun.serve({ port, hostname: '127.0.0.1', fetch: (r) => app.fetch(r) });
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 960, height: 720 } });
  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  const reg = await app
    .fetch(
      new Request(origin + '/api/oauth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
        }),
      }),
    )
    .then((r) => r.json());
  const params = new URLSearchParams({
    client_id: reg.client_id,
    redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
    response_type: 'code',
    resource: origin + '/api/mcp',
    state: 'browser-fixture-state',
    scope: 'read write',
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update('a'.repeat(64)).digest('base64url'),
  });
  await page.goto(origin + '/api/oauth/authorize?' + params);
  await page.getByRole('link', { name: 'Sign in to Tasks' }).waitFor();
  await context.addCookies([
    {
      name: 'tickets_session',
      value: f.session.split('=')[1],
      url: origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await page.reload();
  await page.getByRole('button', { name: 'Connect', exact: true }).waitFor();
  await page.screenshot({ path: '/tmp/tasks-mcp-consent.png', fullPage: true });
  await page.route('https://chatgpt.com/**', (route) =>
    route.fulfill({ status: 200, body: 'OAuth callback fixture' }),
  );
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.waitForURL('https://chatgpt.com/connector_platform_oauth_redirect?**');
  const callback = new URL(page.url());
  if (
    !callback.searchParams.get('code') ||
    callback.searchParams.get('iss') !== origin ||
    errors.length
  )
    throw new Error('Consent browser acceptance failed');
  console.log(
    JSON.stringify({
      pass: true,
      anonymousSignInPrompt: true,
      authenticatedConsent: true,
      codeRedirect: true,
      consoleErrors: errors.length,
      screenshot: '/tmp/tasks-mcp-consent.png',
    }),
  );
} finally {
  await browser.close();
  await server.stop();
  await f.close();
}
