import { test, expect } from 'bun:test';
import { fixture } from './helpers.mjs';
test('an empty team can be renamed and explicitly deleted without touching other work', async () => {
  const f = await fixture();
  try {
    const team = (await f.request('POST', '/api/v1/teams', { key: 'QA', name: 'Quality' })).data;
    const path = '/api/v1/teams/' + team.id;
    expect((await f.request('GET', path)).data.can_delete).toBe(true);
    expect(
      (await f.request('PATCH', path, { name: 'Quality assurance', expected_name: 'Quality' }))
        .status,
    ).toBe(200);
    expect(
      (await f.request('PATCH', path, { name: 'Wrong overwrite', expected_name: 'Quality' }))
        .status,
    ).toBe(409);
    expect((await f.request('DELETE', path, { confirm_key: 'NO' })).status).toBe(422);
    expect((await f.request('DELETE', path, { confirm_key: 'QA' })).status).toBe(200);
    expect((await f.request('GET', path)).status).toBe(404);
    expect((await f.request('GET', '/api/v1/catalog')).data.teams).toHaveLength(1);
  } finally {
    await f.close();
  }
});
test('team deletion rejects linked issues and the last team; anonymous callers cannot inspect it', async () => {
  const f = await fixture();
  try {
    const path = '/api/v1/teams/' + f.init.team_id;
    expect((await f.request('GET', path, undefined, { anonymous: true })).status).toBe(401);
    expect((await f.request('DELETE', path, { confirm_key: 'TKT' })).data.error.code).toBe(
      'LAST_TEAM',
    );
    await f.request('POST', '/api/v1/teams', { key: 'QA', name: 'Quality' });
    await f.create({ title: 'Must remain intact' });
    const result = await f.request('DELETE', path, { confirm_key: 'TKT' });
    expect(result.status).toBe(409);
    expect(result.data.error.code).toBe('TEAM_NOT_EMPTY');
    expect((await f.request('GET', '/api/v1/issues')).data.data).toHaveLength(1);
  } finally {
    await f.close();
  }
});
