import { test, expect } from 'bun:test';
import { configured } from './linear-live-queue.test.mjs';
import {
  enqueueSyncJob,
  readCreationIntent,
  writeEntityState,
} from '../../packages/server/modules/linear-live/store.mjs';
import { reconcileEntityJob } from '../../packages/server/modules/linear-live/engine.mjs';
import { markdownEquivalent } from '../../packages/server/modules/linear-import/source-contract.mjs';
import { targetId } from '../../packages/imports/linear-source.mjs';

// Linear rewrites Markdown it stores: bare domain-like words become links and an HTML comment
// following a quote is pulled into the quote. Observed on production HYP epics 2026-09-29.
const AUTHORED = [
  'Collects the ship.sh fallback gaps.',
  '',
  '> quoted request',
  '<!-- tasklib:msgref-quote:1 -->',
].join('\n');
const LINEAR_STORED = [
  'Collects the [ship.sh](<http://ship.sh>) fallback gaps.',
  '',
  '> quoted request',
  '> <!-- tasklib:msgref-quote:1 -->',
].join('\n');

test('the fixture reproduces a normalization the content comparison rejects', () => {
  expect(markdownEquivalent(LINEAR_STORED, AUTHORED)).toBe(false);
});

const MODELS = {
  issues: { find: 'issues', create: 'issueCreate', field: 'issue', one: 'issue' },
  comments: { find: 'comments', create: 'commentCreate', field: 'comment', one: 'comment' },
  documents: { find: 'documents', create: 'documentCreate', field: 'document', one: 'document' },
};

// A Linear stand-in for one collection: `stored(input)` is what Linear keeps for a create
// input; `loseCreateResponse` stores the record but answers the create with a 502.
function linearStub(
  source,
  collection,
  stored,
  { record = null, loseCreateResponse = false } = {},
) {
  const model = MODELS[collection];
  const state = { record, creates: 0 };
  state.fetcher = async (_url, options) => {
    const { query, variables } = JSON.parse(options.body);
    if (query.includes('SyncOrganization'))
      return Response.json({ data: { organization: { id: source.ids.org } } });
    if (query.includes('SyncFind'))
      return Response.json({
        data: { [model.find]: { nodes: state.record ? [state.record] : [] } },
      });
    if (query.includes('SyncEntity')) return Response.json({ data: { [model.one]: state.record } });
    if (query.includes(model.create)) {
      state.creates++;
      state.record = stored(variables.input);
      if (loseCreateResponse) return new Response('upstream reset', { status: 502 });
      return Response.json({
        data: { [model.create]: { success: true, [model.field]: state.record } },
      });
    }
    throw Error('Unexpected source request');
  };
  return state;
}

const storedIssue = (source) => (input) => ({
  ...source.data.issues[0],
  id: input.id,
  title: input.title,
  description: LINEAR_STORED,
  identifier: 'SRC-3100',
  number: 3100,
  createdAt: input.createdAt,
  updatedAt: '2026-09-29T16:23:33Z',
});

async function nativeJob(f, actor, collection, id, dedupe) {
  return f.db.transaction((tx) =>
    enqueueSyncJob(
      tx,
      actor.workspace_id,
      { kind: 'entity', collection, sourceId: id, targetId: id, side: 'native' },
      dedupe,
    ),
  );
}

async function pendingIssue(f, source, actor) {
  const teamId = targetId(actor.workspace_id, source.ids.org, 'teams', source.ids.team);
  await f.db.transaction((tx) =>
    tx.exec(
      "INSERT INTO module_settings(workspace_id,module,enabled,config) VALUES(?,'linear-numbering',1,?)",
      [actor.workspace_id, JSON.stringify({ authority: 'linear', teamIds: [teamId] })],
    ),
  );
  const made = await f.request('POST', '/api/v1/issues', {
    team_id: teamId,
    title: 'Epic: normalized body',
    description: AUTHORED,
  });
  expect(made.status).toBe(201);
  expect(made.data.key.startsWith('PENDING-')).toBe(true);
  return { issue: made.data, job: await nativeJob(f, actor, 'issues', made.data.id, 'normalized') };
}

// Make a job that failed with a transient error claimable again immediately.
const dueNow = (f, job) =>
  f.db.transaction((tx) =>
    tx.exec("UPDATE outbox SET next_attempt_at='2000-01-01T00:00:00.000Z' WHERE id=?", [job.id]),
  );
const readIssue = async (f, id) => (await f.request('GET', '/api/v1/issues/' + id)).data;
const mappingOf = (f, actor, collection, id) =>
  f.db.transaction((tx) =>
    tx.one(
      'SELECT target_id FROM linear_source_map WHERE workspace_id=? AND collection=? AND source_id=?',
      [actor.workspace_id, collection, id],
    ),
  );

test('a created issue whose body Linear normalizes gets its Linear code and keeps its authored body', async () => {
  const { f, source, actor, env, config } = await configured();
  try {
    const { issue, job } = await pendingIssue(f, source, actor);
    const linear = linearStub(source, 'issues', storedIssue(source));
    const result = await reconcileEntityJob(f.db, env, job.id, config.generation, {
      fetcher: linear.fetcher,
    });
    expect(result.status).toBe('exported');
    const current = await readIssue(f, issue.id);
    expect(current.key).toBe('SRC-3100');
    expect(current.number).toBe(3100);
    expect(current.description).toBe(AUTHORED);
    expect(linear.creates).toBe(1);
    // Linear's echo of the create (nothing edited on either side) must not overwrite the
    // authored body with Linear's rewrite of it.
    linear.record = { ...linear.record, updatedAt: '2026-09-29T17:00:00Z' };
    const echo = await f.db.transaction((tx) =>
      enqueueSyncJob(
        tx,
        actor.workspace_id,
        { kind: 'entity', collection: 'issues', sourceId: issue.id, side: 'source' },
        'normalized-echo',
      ),
    );
    const echoed = await reconcileEntityJob(f.db, env, echo.id, config.generation, {
      fetcher: linear.fetcher,
    });
    expect(echoed.status).toBe('converged');
    expect((await readIssue(f, issue.id)).description).toBe(AUTHORED);
  } finally {
    await f.close();
  }
});

test('a retry after a lost create response adopts the normalized Linear issue instead of wedging', async () => {
  const { f, source, actor, env, config } = await configured();
  try {
    const { issue, job } = await pendingIssue(f, source, actor);
    const linear = linearStub(source, 'issues', storedIssue(source), { loseCreateResponse: true });
    const first = await reconcileEntityJob(f.db, env, job.id, config.generation, {
      fetcher: linear.fetcher,
    });
    expect(first.status).toBe('failed');
    expect((await readIssue(f, issue.id)).key.startsWith('PENDING-')).toBe(true);
    await dueNow(f, job);
    const retried = await reconcileEntityJob(f.db, env, job.id, config.generation, {
      fetcher: linear.fetcher,
    });
    expect(retried.status).toBe('exported');
    expect((await readIssue(f, issue.id)).key).toBe('SRC-3100');
    expect(linear.creates).toBe(1);
  } finally {
    await f.close();
  }
});

test('a pre-existing Linear issue with the same UUID but different content is still refused', async () => {
  const { f, source, actor, env, config } = await configured();
  try {
    const { issue, job } = await pendingIssue(f, source, actor);
    const linear = linearStub(source, 'issues', storedIssue(source), {
      record: {
        ...source.data.issues[0],
        id: issue.id,
        title: 'Someone else’s issue',
        description: 'Unrelated body',
        identifier: 'SRC-3200',
        number: 3200,
      },
    });
    const result = await reconcileEntityJob(f.db, env, job.id, config.generation, {
      fetcher: linear.fetcher,
    });
    expect(result.status).toBe('failed');
    expect(result.code).toBe('SOURCE_IDENTITY_CONFLICT');
    expect((await readIssue(f, issue.id)).key.startsWith('PENDING-')).toBe(true);
    expect(linear.creates).toBe(0);
  } finally {
    await f.close();
  }
});

test('a created comment whose body Linear normalizes is mapped instead of wedging', async () => {
  const { f, source, actor, env, config } = await configured();
  try {
    const issue = targetId(actor.workspace_id, source.ids.org, 'issues', source.ids.issue);
    const made = (
      await f.request('POST', '/api/v1/issues/' + issue + '/comments', { body: AUTHORED })
    ).data;
    const linear = linearStub(source, 'comments', (input) => ({
      id: input.id,
      body: LINEAR_STORED,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      issue: { id: input.issueId },
      user: { id: source.ids.user },
      archivedAt: null,
      parent: null,
    }));
    const job = await nativeJob(f, actor, 'comments', made.id, 'normalized-comment');
    const result = await reconcileEntityJob(f.db, env, job.id, config.generation, {
      fetcher: linear.fetcher,
    });
    expect(result.status).toBe('exported');
    expect(linear.creates).toBe(1);
    expect((await mappingOf(f, actor, 'comments', made.id)).target_id).toBe(made.id);
  } finally {
    await f.close();
  }
});

test('a document retried after a lost create response is adopted and its normalization recorded', async () => {
  const { f, source, actor, env, config } = await configured();
  try {
    const made = (await f.request('POST', '/api/v1/documents', { title: 'Plan', body: AUTHORED }))
      .data;
    const linear = linearStub(
      source,
      'documents',
      (input) => ({
        id: input.id,
        title: input.title,
        content: LINEAR_STORED,
        createdAt: '2026-09-29T16:23:33Z',
        updatedAt: '2026-09-29T16:23:33Z',
        archivedAt: null,
        project: null,
        initiative: null,
        creator: { id: source.ids.user },
      }),
      { loseCreateResponse: true },
    );
    const job = await nativeJob(f, actor, 'documents', made.id, 'normalized-document');
    const first = await reconcileEntityJob(f.db, env, job.id, config.generation, {
      fetcher: linear.fetcher,
    });
    expect(first.status).toBe('failed');
    await dueNow(f, job);
    const retried = await reconcileEntityJob(f.db, env, job.id, config.generation, {
      fetcher: linear.fetcher,
    });
    expect(retried.status).toBe('exported');
    expect(retried.conflicts).toEqual(['body']);
    expect(linear.creates).toBe(1);
    expect((await mappingOf(f, actor, 'documents', made.id)).target_id).toBe(made.id);
  } finally {
    await f.close();
  }
});

test('only a create intent for the same target counts as proof that we created the record', async () => {
  const { f, actor } = await configured();
  try {
    const target = crypto.randomUUID();
    const read = () =>
      f.db.transaction((tx) => readCreationIntent(tx, actor.workspace_id, 'issues', target));
    const write = (intent) =>
      f.db.transaction((tx) =>
        writeEntityState(tx, actor.workspace_id, 'issues', target, { sourceId: target, intent }),
      );
    // The engine's source-write intent carries no kind; it must never widen adoption.
    await write({ input: {}, sourceBefore: {}, nativeBefore: { id: target } });
    expect(await read()).toBeNull();
    await write({ kind: 'create', input: {}, nativeBefore: { id: crypto.randomUUID() } });
    expect(await read()).toBeNull();
    await write({ kind: 'create', input: {}, nativeBefore: { id: target } });
    expect((await read()).nativeBefore.id).toBe(target);
  } finally {
    await f.close();
  }
});

test('a Linear rename between a lost create response and its retry stays a visible identity conflict', async () => {
  const { f, source, actor, env, config } = await configured();
  try {
    const { issue, job } = await pendingIssue(f, source, actor);
    const linear = linearStub(source, 'issues', storedIssue(source), { loseCreateResponse: true });
    await reconcileEntityJob(f.db, env, job.id, config.generation, { fetcher: linear.fetcher });
    linear.record = { ...linear.record, title: 'Renamed in Linear' };
    await dueNow(f, job);
    const retried = await reconcileEntityJob(f.db, env, job.id, config.generation, {
      fetcher: linear.fetcher,
    });
    expect(retried.code).toBe('SOURCE_IDENTITY_CONFLICT');
    expect((await readIssue(f, issue.id)).key.startsWith('PENDING-')).toBe(true);
  } finally {
    await f.close();
  }
});
