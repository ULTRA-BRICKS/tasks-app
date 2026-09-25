import { test, expect } from 'bun:test';
import { fixture } from './helpers.mjs';
test('reference graph exports bounded pages and reports its coverage instead of returning every body at once', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 12; i++)
      await f.create({ title: 'Graph node ' + i, description: 'x'.repeat(90000) });
    const overview = await f.request('GET', '/api/v1/sync/linear/numbering/graph');
    expect(overview.status).toBe(200);
    expect(overview.data.sections).toContain('issues');
    expect(overview.data.records).toBeUndefined();
    const first = await f.request(
      'GET',
      '/api/v1/sync/linear/numbering/graph?section=issues&limit=100',
    );
    expect(first.status).toBe(200);
    expect(Buffer.byteLength(JSON.stringify(first.data))).toBeLessThan(1000000);
    expect(first.data.next_cursor).toBeTruthy();
    const second = await f.request(
      'GET',
      '/api/v1/sync/linear/numbering/graph?section=issues&cursor=' +
        encodeURIComponent(first.data.next_cursor),
    );
    expect(second.status).toBe(200);
    expect(new Set([...first.data.records, ...second.data.records].map((r) => r.id)).size).toBe(12);
    expect(
      (await f.request('GET', '/api/v1/sync/linear/numbering/graph?section=users')).status,
    ).toBe(422);
    expect(
      (await f.request('GET', '/api/v1/sync/linear/numbering/graph?section=issues&cursor=invalid'))
        .status,
    ).toBe(422);
  } finally {
    await f.close();
  }
});
