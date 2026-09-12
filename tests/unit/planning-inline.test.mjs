import { test, expect } from 'bun:test';
import { fixture } from './helpers.mjs';
test('cycle edits are durable, versioned and validate date order', async () => {
  const f = await fixture();
  try {
    const cycle = (
      await f.request('POST', '/api/v1/cycles', {
        name: 'Sprint',
        team_id: f.init.team_id,
        start_date: '2026-10-01',
        end_date: '2026-10-14',
      })
    ).data;
    const changed = await f.request('PATCH', '/api/v1/cycles/' + cycle.id, {
      version: 1,
      name: 'October',
    });
    expect(changed.status).toBe(200);
    expect(changed.data.version).toBe(2);
    expect(
      (await f.request('PATCH', '/api/v1/cycles/' + cycle.id, { version: 1, name: 'Stale' }))
        .status,
    ).toBe(409);
    expect(
      (
        await f.request('PATCH', '/api/v1/cycles/' + cycle.id, {
          version: 2,
          start_date: '2026-11-01',
        })
      ).status,
    ).toBe(422);
    expect(
      (await f.request('GET', '/api/v1/cycles')).data.find((c) => c.id === cycle.id).name,
    ).toBe('October');
  } finally {
    await f.close();
  }
});
test('project/cycle creation retries reuse the same result, never cross operation types', async () => {
  const f = await fixture();
  try {
    const headers = { 'idempotency-key': 'planning-retry' },
      input = { name: 'Release', team_ids: [f.init.team_id] };
    const a = await f.request('POST', '/api/v1/projects', input, { headers });
    const b = await f.request('POST', '/api/v1/projects', input, { headers });
    expect(a.status).toBe(201);
    expect(b.data.id).toBe(a.data.id);
    expect((await f.request('GET', '/api/v1/projects')).data).toHaveLength(1);
    expect(
      (await f.request('POST', '/api/v1/projects', { ...input, name: 'Different' }, { headers }))
        .status,
    ).toBe(409);
    expect(
      (
        await f.request(
          'POST',
          '/api/v1/cycles',
          {
            name: 'Cycle',
            team_id: f.init.team_id,
            start_date: '2026-10-01',
            end_date: '2026-10-14',
          },
          { headers },
        )
      ).status,
    ).toBe(409);
    expect((await f.request('POST', '/api/v1/projects', { ...input, name: '   ' })).status).toBe(
      422,
    );
  } finally {
    await f.close();
  }
});

test('project retries ignore JSON object key ordering', async () => {
  const f = await fixture();
  try {
    const headers = { 'idempotency-key': 'reordered-fields' };
    const a = await f.request(
      'POST',
      '/api/v1/projects',
      { name: 'Same', team_ids: [f.init.team_id] },
      { headers },
    );
    const b = await f.request(
      'POST',
      '/api/v1/projects',
      { team_ids: [f.init.team_id], name: 'Same' },
      { headers },
    );
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.data.id).toBe(a.data.id);
  } finally {
    await f.close();
  }
});
