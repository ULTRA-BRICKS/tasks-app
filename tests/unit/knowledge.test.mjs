import { test, expect } from 'bun:test';
import { fixture } from './helpers.mjs';

test('documents and initiatives support scoped versioned CRUD and idempotent creation', async () => {
  const f = await fixture();
  try {
    const options = { headers: { 'idempotency-key': 'knowledge-document-fixture' } };
    const created = await f.request(
      'POST',
      '/api/v1/documents',
      { title: 'Full document', body: 'αβ\n'.repeat(40000) },
      options,
    );
    expect(created.status).toBe(201);
    expect(
      (
        await f.request(
          'POST',
          '/api/v1/documents',
          { title: 'Full document', body: 'αβ\n'.repeat(40000) },
          options,
        )
      ).data.id,
    ).toBe(created.data.id);
    expect(
      (
        await f.request('GET', '/api/v1/documents/' + created.data.id, undefined, {
          anonymous: true,
        })
      ).status,
    ).toBe(401);
    const updated = await f.request('PATCH', '/api/v1/documents/' + created.data.id, {
      version: 1,
      title: 'Revised',
    });
    expect(updated.status).toBe(200);
    expect(updated.data.version).toBe(2);
    expect(updated.data.body).toBe(created.data.body);
    expect(
      (
        await f.request('PATCH', '/api/v1/documents/' + created.data.id, {
          version: 1,
          body: 'stale overwrite',
        })
      ).status,
    ).toBe(409);
    const archived = await f.request('PATCH', '/api/v1/documents/' + created.data.id, {
      version: 2,
      archived: true,
    });
    expect(archived.status).toBe(200);
    expect((await f.request('GET', '/api/v1/documents')).data).toHaveLength(0);
    expect((await f.request('GET', '/api/v1/documents?archived=true')).data).toHaveLength(1);
    const initiative = await f.request('POST', '/api/v1/initiatives', {
      name: 'Roadmap',
      status: 'active',
    });
    expect(initiative.status).toBe(201);
    expect(
      (
        await f.request('PATCH', '/api/v1/initiatives/' + initiative.data.id, {
          version: 1,
          name: ' ',
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await f.request('POST', '/api/v1/documents', {
          title: 'Cross-reference',
          initiative_id: crypto.randomUUID(),
        })
      ).status,
    ).toBe(404);
  } finally {
    await f.close();
  }
});
