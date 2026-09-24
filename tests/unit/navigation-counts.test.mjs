import { test, expect } from 'bun:test';
import { fixture } from './helpers.mjs';
test('sidebar counters describe server totals instead of the currently loaded page', async () => {
  const f = await fixture();
  try {
    const before = await f.request('GET', '/api/v1/catalog');
    expect(before.data.counts).toMatchObject({
      issues: 0,
      epics: 0,
      projects: 0,
      cycles: 0,
      documents: 0,
      initiatives: 0,
    });
    await f.create({ title: 'Ordinary task' });
    await f.create({ title: 'Epic task', kind: 'epic' });
    const after = await f.request('GET', '/api/v1/catalog');
    expect(after.data.counts.issues).toBe(2);
    expect(after.data.counts.epics).toBe(1);
    expect((await f.request('GET', '/api/v1/catalog', undefined, { anonymous: true })).status).toBe(
      401,
    );
  } finally {
    await f.close();
  }
});
