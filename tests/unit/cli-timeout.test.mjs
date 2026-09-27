import { test, expect } from 'bun:test';
const cli = new URL('../../packages/cli/tickets.mjs', import.meta.url).pathname;
async function run(args, url) {
  const child = Bun.spawn([process.execPath, cli, ...args], {
    env: {
      ...process.env,
      TICKETS_URL: url,
      TICKETS_TOKEN: 'synthetic-timeout-test-token',
      TICKETS_CONFIG_DIR: '/tmp/nonexistent-tasks-timeout-config',
    },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    code: await child.exited,
    out: await new Response(child.stdout).text(),
    err: await new Response(child.stderr).text(),
  };
}
test('CLI accepts an explicit bounded network deadline for long administrator operations', async () => {
  const server = Bun.serve({
    port: 0,
    fetch: async () => {
      await Bun.sleep(150);
      return Response.json({ ok: true });
    },
  });
  try {
    const result = await run(
      ['api', 'GET', '/api/v1/check', '--timeout-ms', '1000'],
      server.url.href,
    );
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out).ok).toBe(true);
    const timedOut = await run(
      ['api', 'GET', '/api/v1/check', '--timeout-ms', '30'],
      server.url.href,
    );
    expect(timedOut.code).not.toBe(0);
  } finally {
    await server.stop(true);
  }
});
test('CLI rejects unbounded or invalid deadlines without making a network request', async () => {
  let calls = 0;
  const server = Bun.serve({
    port: 0,
    fetch: () => {
      calls++;
      return Response.json({ ok: true });
    },
  });
  try {
    for (const value of ['0', '-1', '60001', 'NaN']) {
      const result = await run(
        ['api', 'GET', '/api/v1/check', '--timeout-ms', value],
        server.url.href,
      );
      expect(result.code).toBe(2);
    }
    expect(calls).toBe(0);
  } finally {
    await server.stop(true);
  }
});
