import { test, expect } from 'bun:test';
import { fixture } from './helpers.mjs';
import {
  syncFixture,
  linearWebhookPayload,
  signedWebhookRequest,
  fakeLinearTransport,
} from './linear-sync-fixture.mjs';
import { runLinearSyncWorker } from '../../packages/server/modules/linear-sync/worker.mjs';
import { targetId } from '../../packages/imports/linear-source.mjs';

async function enqueue(f, source, id, action, occurredAt) {
  const payload = linearWebhookPayload({
    type: 'Issue',
    action,
    dataId: id,
    organizationId: source.ids.org,
  });
  payload.createdAt = occurredAt;
  const signed = signedWebhookRequest(payload, f.env.LINEAR_WEBHOOK_SECRET);
  const result = await f.request('POST', '/api/webhooks/linear', signed.raw, {
    raw: true,
    headers: signed.headers,
  });
  expect(result.status).toBe(200);
}
const transport = (source, issuesById = {}) =>
  fakeLinearTransport({ organizationId: source.ids.org, issuesById });

test('a removal predating the imported snapshot cannot mark its newer issue removed', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const original = source.data.issues.find((row) => row.id === source.ids.issue);
    await enqueue(
      f,
      source,
      original.id,
      'remove',
      new Date(Date.parse(original.updatedAt) - 86400000).toISOString(),
    );
    await runLinearSyncWorker(f.db, f.env, { limit: 1, fetcher: transport(source) });
    const mapping = await f.db.transaction((tx) =>
      tx.one(
        'SELECT source_deleted_at FROM linear_source_map WHERE workspace_id=? AND collection=? AND source_id=?',
        [f.init.workspace_id, 'issues', original.id],
      ),
    );
    expect(mapping.source_deleted_at).toBeNull();
  } finally {
    await f.close();
  }
});

test('an unmapped source removal prevents a delayed older create from resurrecting it', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const sourceId = crypto.randomUUID();
    const remote = {
      ...source.data.issues.find((row) => row.id === source.ids.issue),
      id: sourceId,
      identifier: 'SRC-9099',
      number: 9099,
      parent: null,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await enqueue(f, source, sourceId, 'remove', '2026-01-02T00:00:00.000Z');
    await runLinearSyncWorker(f.db, f.env, { limit: 1, fetcher: transport(source) });
    await enqueue(f, source, sourceId, 'create', remote.updatedAt);
    await runLinearSyncWorker(f.db, f.env, {
      limit: 1,
      fetcher: transport(source, { [sourceId]: remote }),
    });
    const row = await f.db.transaction((tx) =>
      tx.one('SELECT id FROM issues WHERE workspace_id=? AND id=?', [
        f.init.workspace_id,
        targetId(f.init.workspace_id, source.ids.org, 'issues', sourceId),
      ]),
    );
    expect(row).toBeNull();
  } finally {
    await f.close();
  }
});

test('source numbering collisions allocate a new native key without merging unrelated tasks', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const original = source.data.issues.find((row) => row.id === source.ids.issue);
    const sourceId = crypto.randomUUID();
    const remote = {
      ...original,
      id: sourceId,
      title: 'Different issue sharing the source number',
      parent: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await enqueue(f, source, sourceId, 'create', remote.updatedAt);
    const result = await runLinearSyncWorker(f.db, f.env, {
      limit: 1,
      fetcher: transport(source, { [sourceId]: remote }),
    });
    expect(result.processed).toBe(1);
    const native = await f.request(
      'GET',
      '/api/v1/issues/' + targetId(f.init.workspace_id, source.ids.org, 'issues', sourceId),
    );
    expect(native.status).toBe(200);
    expect(native.data.title).toBe(remote.title);
    expect(native.data.key).not.toBe(original.identifier);
    expect(
      native.data.links.some(
        (link) =>
          link.provider === 'linear' &&
          link.external_id === sourceId &&
          link.title === original.identifier,
      ),
    ).toBe(true);
    const retained = await f.request(
      'GET',
      '/api/v1/issues/' + targetId(f.init.workspace_id, source.ids.org, 'issues', original.id),
    );
    expect(retained.data.title).toBe(original.title);
    expect(retained.data.version).toBe(1);
    await enqueue(f, source, sourceId, 'update', remote.updatedAt);
    await runLinearSyncWorker(f.db, f.env, {
      limit: 1,
      fetcher: transport(source, { [sourceId]: remote }),
    });
    const replay = await f.request('GET', '/api/v1/issues/' + native.data.id);
    expect(replay.data.key).toBe(native.data.key);
    expect(replay.data.version).toBe(native.data.version);
  } finally {
    await f.close();
  }
});

test('removal receipts compare instants across fractional timestamp representations', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const sourceId=crypto.randomUUID();
    const record={...source.data.issues.find(r=>r.id===source.ids.issue),id:sourceId,identifier:'SRC-9098',number:9098,parent:null,updatedAt:'2026-01-02T00:00:00.200Z'};
    for(const removedAt of ['2026-01-02T00:00:00Z','2026-01-02T00:00:00.500Z']){
      await enqueue(f,source,sourceId,'remove',removedAt);
      await runLinearSyncWorker(f.db,f.env,{limit:1,fetcher:transport(source)});
    }
    await enqueue(f,source,sourceId,'create',record.updatedAt);
    await runLinearSyncWorker(f.db,f.env,{limit:1,fetcher:transport(source,{[sourceId]:record})});
    const row=await f.db.transaction(tx=>tx.one('SELECT id FROM issues WHERE workspace_id=? AND id=?',[f.init.workspace_id,targetId(f.init.workspace_id,source.ids.org,'issues',sourceId)]));
    expect(row).toBeNull();
  }finally{await f.close();}
});
test('a source update expressed with a timezone offset cannot regress a newer instant',async()=>{
  const {f,source}=await syncFixture(fixture);
  try{
    const original=source.data.issues.find(r=>r.id===source.ids.issue);
    for(const [title,updatedAt] of [['Newer','2026-01-01T00:00:00.000Z'],['Older','2026-01-01T13:00:00+14:00']]){
      const record={...original,title,updatedAt};
      await enqueue(f,source,original.id,'update',updatedAt);
      await runLinearSyncWorker(f.db,f.env,{limit:1,fetcher:transport(source,{[original.id]:record})});
    }
    const issue=(await f.request('GET','/api/v1/issues/'+targetId(f.init.workspace_id,source.ids.org,'issues',original.id))).data;
    expect(issue.title).toBe('Newer');
  }finally{await f.close();}
});

test('source priorities and issue identities obey native domain bounds before SQL',async()=>{
  const {sourceFixture}=await import('./linear-import-fixture.mjs');
  const {mapIssue}=await import('../../packages/server/modules/linear-sync/map.mjs');
  const source=sourceFixture(),original=source.data.issues.find(r=>r.id===source.ids.issue);
  const resolve=(collection,id)=>targetId('00000000-0000-4000-8000-000000000001',source.ids.org,collection,id);
  for(const patch of [{priority:5},{priority:1.5},{priority:-1},{number:-1},{number:1.5},{title:''},{title:'   '},{id:'not-a-uuid'},{identifier:'bad'}]){
    const mapped=mapIssue({...original,...patch},resolve);
    expect(mapped.blocked).toBe(true);expect(mapped.malformed.length).toBeGreaterThan(0);
  }
});

test('a permanent native parent validation failure is blocked immediately, not retried as a transport error',async()=>{
  const {f,source}=await syncFixture(fixture);
  try{
    const original=source.data.issues.find(r=>r.id===source.ids.issue),child=source.data.issues.find(r=>r.id!==source.ids.issue);
    const childId=targetId(f.init.workspace_id,source.ids.org,'issues',child.id);
    expect((await f.request('PATCH','/api/v1/issues/'+childId,{version:1,deleted:true})).status).toBe(200);
    const record={...original,parent:{id:child.id},updatedAt:'2026-01-01T00:00:00.000Z'};
    await enqueue(f,source,original.id,'update',record.updatedAt);
    await runLinearSyncWorker(f.db,f.env,{limit:1,fetcher:transport(source,{[original.id]:record})});
    const row=await f.db.transaction(tx=>tx.one('SELECT status,last_error FROM linear_webhook_inbox WHERE workspace_id=?',[f.init.workspace_id]));
    expect(row.status).toBe('blocked');expect(row.last_error).toBe('INVALID_PARENT');
  }finally{await f.close();}
});
test('a failed fetch cannot reset a completed inbox record with an unchanged token',async()=>{
  const {f,source}=await syncFixture(fixture);
  try{
    await enqueue(f,source,source.ids.issue,'update','2026-01-01T00:00:00.000Z');
    const base=transport(source);
    await runLinearSyncWorker(f.db,f.env,{limit:1,fetcher:async(url,options)=>{
      if(JSON.parse(options.body).query.includes('issue(id')){
        await f.db.transaction(tx=>tx.exec("UPDATE linear_webhook_inbox SET status='done' WHERE workspace_id=?",[f.init.workspace_id]));
        throw Error('Synthetic late transport failure');
      }return base(url,options);
    }});
    const row=await f.db.transaction(tx=>tx.one('SELECT status,last_error FROM linear_webhook_inbox WHERE workspace_id=?',[f.init.workspace_id]));
    expect(row.status).toBe('done');expect(row.last_error).toBeNull();
  }finally{await f.close();}
});

test('an importer downgraded to read-only cannot continue writing through the sync worker',async()=>{
  const {f,source}=await syncFixture(fixture);
  try{
    const original=source.data.issues.find(r=>r.id===source.ids.issue),record={...original,title:'Must not apply',updatedAt:'2026-01-01T00:00:00.000Z'};
    await enqueue(f,source,original.id,'update',record.updatedAt);
    await f.db.transaction(tx=>tx.exec('UPDATE memberships SET role=? WHERE workspace_id=? AND user_id=?',['viewer',f.init.workspace_id,f.init.user_id]));
    await runLinearSyncWorker(f.db,f.env,{limit:1,fetcher:transport(source,{[original.id]:record})});
    const row=await f.db.transaction(tx=>tx.one('SELECT title,version FROM issues WHERE workspace_id=? AND id=?',[f.init.workspace_id,targetId(f.init.workspace_id,source.ids.org,'issues',original.id)]));
    expect(row.title).toBe(original.title);expect(row.version).toBe(1);
    const job=await f.db.transaction(tx=>tx.one('SELECT status FROM linear_webhook_inbox WHERE workspace_id=?',[f.init.workspace_id]));
    expect(job.status).toBe('blocked');
  }finally{await f.close();}
});
