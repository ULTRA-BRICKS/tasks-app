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

test('two concurrent removals cannot remove the final workspace team', async () => {
  const f = await fixture();
  try {
    const original = (await f.request('GET', '/api/v1/catalog')).data.teams[0];
    const other = (await f.request('POST', '/api/v1/teams', { key: 'QC', name: 'Concurrent test' }))
      .data;
    const results = await Promise.all(
      [original, other].map((team) =>
        f.request('DELETE', '/api/v1/teams/' + team.id, { confirm_key: team.key }),
      ),
    );
    expect(results.map((result) => result.status).sort((a, b) => a - b)).toEqual([200, 409]);
    expect((await f.request('GET', '/api/v1/catalog')).data.teams).toHaveLength(1);
    expect(await f.db.transaction((tx) => tx.all('PRAGMA foreign_key_check'))).toEqual([]);
  } finally {
    await f.close();
  }
});

test('read-scoped API credentials cannot rename or remove a team', async () => {
  const f = await fixture();
  try {
    const team = (await f.request('POST', '/api/v1/teams', { key: 'RD', name: 'Read scoped team' }))
      .data;
    const token = (
      await f.request('POST', '/api/v1/tokens', { name: 'Read-only test', scopes: ['read'] })
    ).data.token;
    const options = { anonymous: true, headers: { authorization: 'Bearer ' + token } };
    expect((await f.request('GET', '/api/v1/teams/' + team.id, undefined, options)).status).toBe(
      200,
    );
    expect(
      (
        await f.request(
          'PATCH',
          '/api/v1/teams/' + team.id,
          { name: 'Changed', expected_name: team.name },
          options,
        )
      ).status,
    ).toBe(403);
    expect(
      (await f.request('DELETE', '/api/v1/teams/' + team.id, { confirm_key: team.key }, options))
        .status,
    ).toBe(403);
    expect((await f.request('GET', '/api/v1/teams/' + team.id)).data.name).toBe(team.name);
  } finally {
    await f.close();
  }
});
