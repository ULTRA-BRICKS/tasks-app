import { test, expect } from 'bun:test';
import { createHash } from 'node:crypto';
import { MAX_UPLOAD } from '../../packages/server/modules/attachments/service.mjs';
import { uploadImportFile } from '../../packages/server/modules/linear-import/files.mjs';
import { fixture } from './helpers.mjs';
import { sourceFixture } from './linear-import-fixture.mjs';
import { collections, targetId } from '../../packages/imports/linear-source.mjs';
async function stage(f, source) {
  const created = await f.request('POST', '/api/v1/imports/linear', { manifest: source.manifest });
  expect(created.status).toBe(201);
  const run = created.data.id;
  for (const collection of collections)
    if (source.data[collection].length) {
      const result = await f.request('POST', `/api/v1/imports/linear/${run}/records`, {
        collection,
        records: source.data[collection],
      });
      expect(result.status).toBe(200);
    }
  return run;
}
test('full fixture imports through the authenticated API without granting source identities access', async () => {
  const f = await fixture(),
    source = sourceFixture();
  try {
    const run = await stage(f, source);
    const plan = await f.request('POST', `/api/v1/imports/linear/${run}/plan`);
    expect(plan.status).toBe(200);
    expect(plan.data.safe_to_apply).toBe(true);
    const result = await f.request('POST', `/api/v1/imports/linear/${run}/apply`, {
      plan_hash: plan.data.plan_hash,
    });
    expect(result.status).toBe(200);
    expect(result.data.counts.issues).toBe(2);
    const key = targetId(f.init.workspace_id, source.ids.org, 'issues', source.ids.issue);
    const detail = await f.request('GET', '/api/v1/issues/' + key);
    expect(detail.status).toBe(200);
    expect(detail.data.description).toBe(source.data.issues[1].description);
    expect(detail.data.created_at).toBe(source.data.issues[1].createdAt);
    expect(detail.data.comments[0].body).toBe(source.data.comments[0].body);
    expect(detail.data.relations).toHaveLength(1);
    expect(detail.data.comments[0].author_name).toBe('Source author');
    const graph = await f.request('POST', '/graphql', {
      query: `{issue(id:"${key}"){id assignee{id name active} creator{id name active} comments{nodes{user{name}}}}}`,
    });
    expect(graph.data.errors).toBeUndefined();
    expect(graph.data.data.issue.creator.name).toBe('Source author');
    expect(graph.data.data.issue.assignee.active).toBe(false);
    expect(graph.data.data.issue.comments.nodes[0].user.name).toBe('Source author');

    const catalog = await f.request('GET', '/api/v1/catalog');
    expect(catalog.data.people).toHaveLength(1);
    expect(catalog.data.source_people).toHaveLength(1);
    const counts = await f.db.transaction((tx) =>
      tx.one(
        'SELECT (SELECT COUNT(*) FROM users) AS users,(SELECT COUNT(*) FROM memberships) AS memberships',
      ),
    );
    expect(Number(counts.users)).toBe(1);
    expect(Number(counts.memberships)).toBe(1);
    const docs = await f.request('GET', '/api/v1/documents');
    expect(docs.data[0].body).toBe(source.data.documents[0].content);
    const initiatives = await f.request('GET', '/api/v1/initiatives');
    expect(initiatives.data[0].name).toBe('Original initiative');
    const archivedSource = await f.request(
      'GET',
      '/api/v1/imported-source/issueHistory/' + source.ids.issue,
    );
    expect(archivedSource.data).toEqual(source.data.issueHistory[0]);
    const edited = await f.request('PATCH', '/api/v1/issues/' + key, {
      title: 'Changed in Tasks',
      version: detail.data.version,
    });
    expect(edited.status).toBe(200);
    const retry = await f.request('POST', `/api/v1/imports/linear/${run}/apply`, {
      plan_hash: plan.data.plan_hash,
    });
    expect(retry.status).toBe(200);
    expect((await f.request('GET', '/api/v1/issues/' + key)).data.title).toBe('Changed in Tasks');
    const rows = await f.db.transaction((tx) => tx.one('SELECT COUNT(*) AS n FROM issues'));
    expect(Number(rows.n)).toBe(2);
  } finally {
    await f.close();
  }
});

test('staging rejects changed duplicate payloads and cannot apply incomplete snapshots', async () => {
  const f = await fixture(),
    source = sourceFixture();
  try {
    const run = (await f.request('POST', '/api/v1/imports/linear', { manifest: source.manifest }))
      .data.id;
    const url = `/api/v1/imports/linear/${run}/records`;
    const batch = { collection: 'teams', records: source.data.teams };
    expect((await f.request('POST', url, batch)).data.inserted).toBe(1);
    expect((await f.request('POST', url, batch)).data.unchanged).toBe(1);
    expect(
      (
        await f.request('POST', url, {
          ...batch,
          records: [{ ...batch.records[0], name: 'Different source' }],
        })
      ).status,
    ).toBe(409);
    expect((await f.request('POST', `/api/v1/imports/linear/${run}/plan`)).status).toBe(409);
    expect(
      (
        await f.request(
          'POST',
          '/api/v1/imports/linear',
          { manifest: source.manifest },
          { anonymous: true },
        )
      ).status,
    ).toBe(401);
    expect((await f.request('POST', url, batch, { noCsrf: true })).status).toBe(403);
  } finally {
    await f.close();
  }
});

test('private file links prevent production apply instead of silently losing bytes', async () => {
  const f = await fixture(),
    source = sourceFixture();
  try {
    source.data.issues[0].description +=
      '\n![private](https://uploads.linear.app/fixture/image.png)';
    const run = await stage(f, source);
    const plan = await f.request('POST', `/api/v1/imports/linear/${run}/plan`);
    expect(plan.status).toBe(200);
    expect(plan.data.private_files_pending).toBe(1);
    const result = await f.request('POST', `/api/v1/imports/linear/${run}/apply`, {
      plan_hash: plan.data.plan_hash,
    });
    expect(result.status).toBe(409);
    expect(result.data.error.code).toBe('PRIVATE_FILES_PENDING');
    expect(
      Number((await f.db.transaction((tx) => tx.one('SELECT COUNT(*) AS n FROM issues'))).n),
    ).toBe(0);
    expect(
      (await f.request('GET', '/api/v1/imported-source/issues/' + source.ids.issue)).status,
    ).toBe(404);
  } finally {
    await f.close();
  }
});

test('private files require verified bytes, stay private and survive import retries', async () => {
  const f = await fixture(),
    source = sourceFixture();
  try {
    source.data.issues[0].description += '\n[file](https://uploads.linear.app/fixture/private.txt)';
    const run = await stage(f, source);
    const plan = (await f.request('POST', `/api/v1/imports/linear/${run}/plan`)).data;
    const file = plan.files[0],
      bytes = Buffer.from('Exact source file bytes — кириллица');
    const hash = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
    const path = `/api/v1/imports/linear/${run}/files/${file.id}/content`;
    expect((await f.request('GET', `/api/v1/imported-files/${file.id}/content`)).status).toBe(404);
    expect(
      (
        await f.request('PUT', path, bytes, {
          raw: true,
          headers: { 'content-type': 'text/plain', 'x-file-sha256': '0'.repeat(64) },
        })
      ).status,
    ).toBe(422);
    const options = {
      raw: true,
      headers: {
        'content-type': 'text/plain',
        'x-file-sha256': hash,
        'x-file-name': 'original.txt',
      },
    };
    expect((await f.request('PUT', path, bytes, options)).status).toBe(200);
    expect((await f.request('PUT', path, bytes, options)).data.unchanged).toBe(true);
    const updated = (await f.request('POST', `/api/v1/imports/linear/${run}/plan`)).data;
    expect(updated.safe_to_apply).toBe(true);
    expect(updated.private_files_pending).toBe(0);
    expect(
      (
        await f.request('POST', `/api/v1/imports/linear/${run}/apply`, {
          plan_hash: plan.plan_hash,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await f.request('POST', `/api/v1/imports/linear/${run}/apply`, {
          plan_hash: updated.plan_hash,
        })
      ).status,
    ).toBe(200);
    const content = await f.request('GET', `/api/v1/imported-files/${file.id}/content`);
    expect(content.status).toBe(200);
    expect(content.data).toBe(bytes.toString());
    expect(content.headers.get('content-disposition')).toStartWith('attachment;');
    expect(
      (
        await f.request('GET', `/api/v1/imported-files/${file.id}/content`, undefined, {
          anonymous: true,
        })
      ).status,
    ).toBe(401);
  } finally {
    await f.close();
  }
});

test('unavailable source files are explicit, not reported as downloaded or silently skipped', async () => {
  const f = await fixture(),
    source = sourceFixture();
  try {
    source.data.issues[0].description +=
      '\n![missing](https://uploads.linear.app/fixture/missing.png)';
    const run = await stage(f, source);
    const plan = (await f.request('POST', `/api/v1/imports/linear/${run}/plan`)).data;
    const id = plan.files[0].id,
      url = `/api/v1/imports/linear/${run}/files/${id}/unavailable`;
    expect((await f.request('POST', url, { source_status: 403 })).status).toBe(422);
    expect((await f.request('POST', url, { source_status: 404 })).status).toBe(200);
    const updated = (await f.request('POST', `/api/v1/imports/linear/${run}/plan`)).data;
    const payload = { plan_hash: updated.plan_hash };
    expect(
      (await f.request('POST', `/api/v1/imports/linear/${run}/apply`, payload)).data.error.code,
    ).toBe('SOURCE_MISSING_CONFIRMATION');
    const applied = await f.request('POST', `/api/v1/imports/linear/${run}/apply`, {
      ...payload,
      accept_missing_source_files: true,
    });
    expect(applied.status).toBe(200);
    expect(applied.data.source_files_unavailable).toHaveLength(1);
    expect((await f.request('GET', `/api/v1/imported-files/${id}/content`)).status).toBe(410);
    const original = await f.request('GET', '/api/v1/imported-source/issues/' + source.ids.child);
    expect(original.data.description).toContain('https://uploads.linear.app/fixture/missing.png');
    expect(f.objects.size).toBe(0);
  } finally {
    await f.close();
  }
});

test('ambiguous source labels fail at planning without merging different identities', async () => {
  const f = await fixture(),
    source = sourceFixture();
  try {
    source.data.issueLabels.push({
      ...source.data.issueLabels[0],
      id: crypto.randomUUID(),
      color: '#abcdef',
    });
    source.manifest.counts.issueLabels++;
    const run = await stage(f, source);
    const plan = await f.request('POST', `/api/v1/imports/linear/${run}/plan`);
    expect(plan.status).toBe(422);
    expect(plan.data.error.code).toBe('AMBIGUOUS_SOURCE_LABELS');
    expect(
      Number((await f.db.transaction((tx) => tx.one('SELECT COUNT(*) AS n FROM issues'))).n),
    ).toBe(0);
  } finally {
    await f.close();
  }
});

test('same-name labels of different teams bind to one native label without double attachment', async () => {
  const f = await fixture(),
    source = sourceFixture();
  try {
    const other = crypto.randomUUID();
    source.data.issueLabels[0].team = { id: source.ids.team };
    source.data.issueLabels.push({
      ...source.data.issueLabels[0],
      id: other,
      color: '#abcdef',
      team: { id: crypto.randomUUID() },
      createdAt: '2024-01-03T03:04:05.006Z',
    });
    source.data.issues[0].labelIds = [source.ids.label, other];
    source.manifest.counts.issueLabels++;
    const run = await stage(f, source);
    const plan = await f.request('POST', `/api/v1/imports/linear/${run}/plan`);
    expect(plan.status).toBe(200);
    expect(
      (
        await f.request('POST', `/api/v1/imports/linear/${run}/apply`, {
          plan_hash: plan.data.plan_hash,
        })
      ).status,
    ).toBe(200);
    const rows = await f.db.transaction((tx) =>
      tx.all("SELECT id FROM labels WHERE name='Imported fixture'"),
    );
    expect(rows).toHaveLength(1);
    const maps = await f.db.transaction((tx) =>
      tx.all("SELECT target_id FROM linear_source_map WHERE collection='issueLabels'"),
    );
    expect(maps.map((m) => m.target_id)).toEqual([rows[0].id, rows[0].id]);
    const attached = await f.db.transaction((tx) =>
      tx.one('SELECT COUNT(*) AS n FROM issue_labels WHERE label_id=?', [rows[0].id]),
    );
    expect(Number(attached.n)).toBe(2);
  } finally {
    await f.close();
  }
});

test('cross-team same-name labels bind to an existing native label without a name conflict', async () => {
  const f = await fixture(),
    source = sourceFixture();
  try {
    await f.db.transaction((tx) =>
      tx.exec('INSERT INTO labels(id,workspace_id,name,color) VALUES(?,?,?,?)', [
        crypto.randomUUID(),
        f.init.workspace_id,
        'Imported fixture',
        '#000000',
      ]),
    );
    const other = crypto.randomUUID();
    source.data.issueLabels[0].team = { id: source.ids.team };
    source.data.issueLabels.push({
      ...source.data.issueLabels[0],
      id: other,
      team: { id: crypto.randomUUID() },
    });
    source.manifest.counts.issueLabels++;
    const run = await stage(f, source);
    const plan = await f.request('POST', `/api/v1/imports/linear/${run}/plan`);
    expect(plan.status).toBe(200);
    expect(plan.data.reused_labels).toHaveLength(2);
    expect(
      (
        await f.request('POST', `/api/v1/imports/linear/${run}/apply`, {
          plan_hash: plan.data.plan_hash,
        })
      ).status,
    ).toBe(200);
    const rows = await f.db.transaction((tx) =>
      tx.all("SELECT id FROM labels WHERE name='Imported fixture'"),
    );
    expect(rows).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test('offline restore may keep an original above the HTTP upload ceiling, the default refuses it', async () => {
  const f = await fixture(),
    source = sourceFixture();
  try {
    source.data.issues[0].description +=
      '\n![big](https://uploads.linear.app/fixture/big.png)';
    const run = await stage(f, source);
    const plan = (await f.request('POST', `/api/v1/imports/linear/${run}/plan`)).data;
    const bytes = Buffer.alloc(MAX_UPLOAD + 1, 1);
    const metadata = {
      sha256: createHash('sha256').update(bytes).digest('hex'),
      mime: 'application/octet-stream',
      filename: 'big.bin',
    };
    const actor = {
      id: f.init.user_id,
      workspace_id: f.init.workspace_id,
      role: 'owner',
      scopes: ['read', 'write', 'admin'],
    };
    const storage = {
      kind: 'test',
      store: new Map(),
      async put(key, value) {
        this.store.set(key, value);
      },
      async download(key) {
        return { bytes: this.store.get(key) };
      },
    };
    await expect(
      uploadImportFile(f.db, storage, actor, run, plan.files[0].id, bytes, metadata),
    ).rejects.toMatchObject({ code: 'INVALID_IMPORTED_BYTES' });
    const saved = await uploadImportFile(f.db, storage, actor, run, plan.files[0].id, bytes, metadata, {
      maxBytes: MAX_UPLOAD + 1,
    });
    expect(saved.status).toBe('ready');
  } finally {
    await f.close();
  }
});

test('imported duplicate workflow type is preserved both in reads and filters', async () => {
  const f = await fixture(),
    source = sourceFixture();
  try {
    source.data.workflowStates[0].type = 'duplicate';
    source.data.workflowStates[0].name = 'Duplicate';
    const run = await stage(f, source);
    const plan = (await f.request('POST', `/api/v1/imports/linear/${run}/plan`)).data;
    expect(
      (
        await f.request('POST', `/api/v1/imports/linear/${run}/apply`, {
          plan_hash: plan.plan_hash,
        })
      ).status,
    ).toBe(200);
    const graph = await f.request('POST', '/graphql', {
      query: '{ workflowStates(filter:{type:{eq:"duplicate"}}) { nodes { name type } } }',
    });
    expect(graph.data.errors).toBeUndefined();
    expect(graph.data.data.workflowStates.nodes).toEqual([
      { name: 'Duplicate', type: 'duplicate' },
    ]);
    await f.db.transaction((tx) =>
      tx.exec("UPDATE memberships SET role='viewer' WHERE workspace_id=? AND user_id=?", [
        f.init.workspace_id,
        f.init.user_id,
      ]),
    );
    expect(
      (await f.request('GET', '/api/v1/imported-source/users/' + source.ids.user)).status,
    ).toBe(403);
    expect(
      (await f.request('GET', '/api/v1/imported-source/issues/' + source.ids.issue)).status,
    ).toBe(200);
  } finally {
    await f.close();
  }
});

test('PLAN rejects source identities without the non-null email required by Linear GraphQL', async () => {
  const f = await fixture();
  try {
    const source = sourceFixture();
    source.data.users[0].email = null;
    const run = await stage(f, source);
    const planned = await f.request('POST', `/api/v1/imports/linear/${run}/plan`);
    expect(planned.status).toBe(422);
    expect(planned.data.error.code).toBe('UNREPRESENTABLE_SOURCE');
    expect(
      Number((await f.db.transaction((tx) => tx.one('SELECT count(*) AS n FROM source_people'))).n),
    ).toBe(0);
  } finally {
    await f.close();
  }
});

test('HTTP apply acquires the workspace lock after projection, before native writes', async () => {
  const f = await fixture();
  try {
    const source = sourceFixture();
    const run = await stage(f, source);
    const planned = await f.request('POST', `/api/v1/imports/linear/${run}/plan`);
    expect(planned.status).toBe(200);
    const plan = planned.data;
    const operations = [],
      original = f.db.transaction.bind(f.db);
    f.db.transaction = (fn, options) =>
      original(
        (tx) =>
          fn({
            ...tx,
            lock: async (key) => {
              operations.push(key === f.init.workspace_id ? 'workspace-lock' : 'import-lock');
              return tx.lock(key);
            },
            all: async (sql, args) => {
              if (sql.startsWith('SELECT collection,payload')) operations.push('projection');
              return tx.all(sql, args);
            },
            exec: async (sql, args) => {
              if (sql.startsWith('INSERT INTO source_people')) operations.push('native-insert');
              return tx.exec(sql, args);
            },
          }),
        options,
      );
    const applied = await f.request('POST', `/api/v1/imports/linear/${run}/apply`, {
      plan_hash: plan.plan_hash,
    });
    expect(applied.status).toBe(200);
    expect(operations.indexOf('workspace-lock')).toBeGreaterThan(operations.indexOf('projection'));
    expect(operations.indexOf('native-insert')).toBeGreaterThan(
      operations.indexOf('workspace-lock'),
    );
  } finally {
    await f.close();
  }
});
