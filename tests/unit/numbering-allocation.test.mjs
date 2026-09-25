import { test, expect } from 'bun:test';
import { fixture } from './helpers.mjs';
test('Linear-numbered teams retain new tasks under stable provisional IDs instead of starting another official counter', async () => {
  const f = await fixture();
  try {
    await f.db.transaction((tx) =>
      tx.exec(
        "INSERT INTO module_settings(workspace_id,module,enabled,config) VALUES(?,'linear-numbering',1,?)",
        [f.init.workspace_id, JSON.stringify({ authority: 'linear', teamIds: [f.init.team_id] })],
      ),
    );
    const first = await f.request(
      'POST',
      '/api/v1/issues',
      { team_id: f.init.team_id, title: 'Retained until the source assigns its number' },
      { headers: { 'idempotency-key': 'numbering-allocation' } },
    );
    expect(first.status).toBe(201);
    expect(first.data.key).toBe('PENDING-' + first.data.id);
    expect(first.data.number).toBeLessThan(0);
    const second = await f.request(
      'POST',
      '/api/v1/issues',
      { team_id: f.init.team_id, title: 'Retained until the source assigns its number' },
      { headers: { 'idempotency-key': 'numbering-allocation' } },
    );
    expect(second.data.id).toBe(first.data.id);
    expect(second.data.key).toBe(first.data.key);
    const team = await f.db.transaction((tx) =>
      tx.one('SELECT next_number FROM teams WHERE id=?', [f.init.team_id]),
    );
    expect(team.next_number).toBe(1);
  } finally {
    await f.close();
  }
});
