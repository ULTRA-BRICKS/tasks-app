import { test, expect } from 'bun:test';
import { fixture } from './helpers.mjs';

test('repeating a comment request after a lost response creates one comment', async () => {
  const f = await fixture();
  try {
    const issue = (await f.create()).data;
    const path = `/api/v1/issues/${issue.id}/comments`;
    const options = { headers: { 'idempotency-key': 'comment-retry-proof' } };
    const first = await f.request('POST', path, { body: 'Unchanged retry body' }, options);
    const second = await f.request('POST', path, { body: 'Unchanged retry body' }, options);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.data.id).toBe(first.data.id);
    const detail = await f.request('GET', `/api/v1/issues/${issue.id}`);
    expect(detail.data.comments).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test('a retry key cannot silently substitute different comment text', async () => {
  const f = await fixture();
  try {
    const issue = (await f.create()).data,
      path = `/api/v1/issues/${issue.id}/comments`;
    const options = { headers: { 'idempotency-key': 'comment-body-conflict' } };
    expect((await f.request('POST', path, { body: 'Original' }, options)).status).toBe(201);
    const changed = await f.request('POST', path, { body: 'Changed' }, options);
    expect(changed.status).toBe(409);
    expect(changed.data.error.code).toBe('IDEMPOTENCY_CONFLICT');
  } finally {
    await f.close();
  }
});
