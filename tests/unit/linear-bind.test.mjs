import { test, expect } from 'bun:test';
import { fixture } from './helpers.mjs';
import { sourceFixture } from './linear-import-fixture.mjs';
async function setup() {
  const f = await fixture(),
    source = sourceFixture();
  const run = (await f.request('POST', '/api/v1/imports/linear', { manifest: source.manifest }))
    .data.id;
  for (const [collection, records] of Object.entries(source.data))
    if (records.length)
      expect(
        (await f.request('POST', `/api/v1/imports/linear/${run}/records`, { collection, records }))
          .status,
      ).toBe(200);
  const plan = (await f.request('POST', `/api/v1/imports/linear/${run}/plan`)).data;
  expect(
    (await f.request('POST', `/api/v1/imports/linear/${run}/apply`, { plan_hash: plan.plan_hash }))
      .status,
  ).toBe(200);
  return { f, source };
}
test('explicit source binding preserves native content, links UUIDs, and is idempotent', async () => {
  const { f, source } = await setup();
  try {
    const native = (
      await f.create({ title: 'Exported native issue', description: 'Do not alter me' })
    ).data;
    const record = {
      ...source.data.issues[0],
      id: crypto.randomUUID(),
      title: native.title,
      description: native.description,
      identifier: 'SRC-9000',
      number: 9000,
      url: 'https://linear.app/issue/SRC-9000',
    };
    const input = {
      source_workspace_id: source.ids.org,
      bindings: [{ collection: 'issues', record, target_id: native.id }],
    };
    const plan = await f.request('POST', '/api/v1/imports/linear/bind', input);
    expect(plan.status).toBe(200);
    expect(plan.data.applied).toBe(false);
    const result = await f.request('POST', '/api/v1/imports/linear/bind', {
      ...input,
      plan_hash: plan.data.plan_hash,
    });
    expect(result.status).toBe(200);
    expect(result.data.applied).toBe(true);
    const got = (await f.request('GET', '/api/v1/issues/' + native.id)).data;
    expect(got.title).toBe(native.title);
    expect(got.version).toBe(native.version);
    expect(got.key).toBe(native.key);
    expect(got.links.some((l) => l.provider === 'linear' && l.external_id === record.id)).toBe(
      true,
    );
    expect(
      (
        await f.request('POST', '/api/v1/imports/linear/bind', {
          ...input,
          plan_hash: plan.data.plan_hash,
        })
      ).data.unchanged,
    ).toBe(true);
  } finally {
    await f.close();
  }
});
test('binding cannot cross workspaces, overwrite an existing source target, or run without admin', async () => {
  const { f, source } = await setup();
  try {
    const native = (await f.create()).data;
    const input = {
      source_workspace_id: source.ids.org,
      bindings: [{ collection: 'issues', record: source.data.issues[0], target_id: native.id }],
    };
    expect((await f.request('POST', '/api/v1/imports/linear/bind', input)).status).toBe(409);
    expect(
      (await f.request('POST', '/api/v1/imports/linear/bind', input, { anonymous: true })).status,
    ).toBe(401);
    expect(
      (
        await f.request('POST', '/api/v1/imports/linear/bind', {
          ...input,
          source_workspace_id: crypto.randomUUID(),
        })
      ).status,
    ).toBe(403);
  } finally {
    await f.close();
  }
});

test('one binding batch cannot alias two distinct issues to one target', async () => {
  const { f, source } = await setup();
  try {
    const native = (await f.create({ title: 'Same title' })).data;
    const bindings = [1, 2].map((n) => ({
      collection: 'issues',
      target_id: native.id,
      record: {
        id: crypto.randomUUID(),
        title: native.title,
        description: '',
        identifier: 'SRC-' + n,
        url: 'https://linear.app/issue/SRC-' + n,
      },
    }));
    expect(
      (
        await f.request('POST', '/api/v1/imports/linear/bind', {
          source_workspace_id: source.ids.org,
          bindings,
        })
      ).status,
    ).toBe(409);
  } finally {
    await f.close();
  }
});
test('binding validates source URLs, identifiers, and metadata convergence before a plan exists', async () => {
  const { f, source } = await setup();
  try {
    const native = (await f.create()).data;
    const make = (record) => ({
      source_workspace_id: source.ids.org,
      bindings: [{ collection: 'issues', record, target_id: native.id }],
    });
    const record = {
      id: crypto.randomUUID(),
      title: native.title,
      description: '',
      identifier: 'SRC-90',
    };
    expect((await f.request('POST', '/api/v1/imports/linear/bind', make(record))).status).toBe(422);
    expect(
      (await f.request('POST', '/api/v1/imports/linear/bind', make({ ...record, url: 'garbage' })))
        .status,
    ).toBe(422);
    expect(
      (
        await f.request(
          'POST',
          '/api/v1/imports/linear/bind',
          make({ ...record, url: 'https://linear.app/issue/SRC-90', identifier: undefined }),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await f.request('POST', '/api/v1/imports/linear/bind', {
          source_workspace_id: source.ids.org,
          bindings: [
            {
              collection: 'teams',
              target_id: f.init.team_id,
              record: { id: crypto.randomUUID(), name: 'Wrong team', key: 'ZZZ' },
            },
          ],
        })
      ).status,
    ).toBe(409);
  } finally {
    await f.close();
  }
});
test('Markdown formatting changes converge but code and link changes do not', async () => {
  const { f, source } = await setup();
  try {
    const native = (
      await f.create({ title: 'Markdown', description: '## Heading\nText\n\n- item\n- second' })
    ).data;
    const record = {
      id: crypto.randomUUID(),
      title: native.title,
      description: '## Heading\n\nText\n\n* item\n* second',
      identifier: 'SRC-90',
      url: 'https://linear.app/issue/SRC-90',
    };
    const input = {
      source_workspace_id: source.ids.org,
      bindings: [{ collection: 'issues', record, target_id: native.id }],
    };
    expect((await f.request('POST', '/api/v1/imports/linear/bind', input)).status).toBe(200);
    input.bindings[0].record.description = '## Heading\n\nDifferent text';
    expect((await f.request('POST', '/api/v1/imports/linear/bind', input)).status).toBe(409);
  } finally {
    await f.close();
  }
});

test('verified client-assigned identity can be bound without overwriting divergent descriptions',async()=>{
 const {f,source}=await setup();
 const {targetId,digest}=await import('../../packages/imports/linear-source.mjs');
 try{
  const team=targetId(f.init.workspace_id,source.ids.org,'teams',source.ids.team);
  const native=(await f.create({team_id:team,title:'Confirmed exported task',description:'Native text is retained'})).data;
  const record={...source.data.issues[0],id:native.id,title:native.title,description:'Different source text is retained too',createdAt:native.created_at,identifier:'SRC-987',number:987,url:'https://linear.app/issue/SRC-987'};
  const evidence={kind:'client-assigned-uuid',native_version:native.version,native_content_hash:digest({title:native.title,description:native.description}),reason:'Original export snapshot verifies the UUID, title, creation time and owning team; descriptions remain a conflict.'};
  const input={source_workspace_id:source.ids.org,bindings:[{collection:'issues',record,target_id:native.id,identity_evidence:evidence}]};
  const preview=await f.request('POST','/api/v1/imports/linear/bind',input);expect(preview.status).toBe(200);expect(preview.data.bindings[0].content_conflict).toBe(true);
  const applied=await f.request('POST','/api/v1/imports/linear/bind',{...input,plan_hash:preview.data.plan_hash});expect(applied.status).toBe(200);
  const current=(await f.request('GET','/api/v1/issues/'+native.id)).data;expect(current.description).toBe(native.description);expect(current.version).toBe(native.version);expect(current.key).toBe(native.key);
  const id=targetId(f.init.workspace_id,'linear-managed-v1','entity-state','issues:'+native.id);
  const state=await f.db.transaction(tx=>tx.one('SELECT payload FROM outbox WHERE workspace_id=? AND id=?',[f.init.workspace_id,id]));
  expect(JSON.parse(state.payload).conflicts.description.local).toBe(native.description);expect(JSON.parse(state.payload).conflicts.description.source).toBe(record.description);
  expect((await f.request('POST','/api/v1/imports/linear/bind',{...input,plan_hash:preview.data.plan_hash})).data.unchanged).toBe(true);
 }finally{await f.close();}
});
test('divergent-content identity evidence cannot waive UUID, title, timestamp, team or current native version checks',async()=>{
 const {f,source}=await setup();const {targetId,digest}=await import('../../packages/imports/linear-source.mjs');
 try{
  const native=(await f.create({team_id:targetId(f.init.workspace_id,source.ids.org,'teams',source.ids.team),title:'Identity',description:'Local'})).data;
  const record={...source.data.issues[0],id:native.id,title:native.title,description:'Remote',createdAt:native.created_at,identifier:'SRC-987',number:987,url:'https://linear.app/issue/SRC-987'};
  const proof={kind:'client-assigned-uuid',native_version:native.version,native_content_hash:digest({title:native.title,description:native.description}),reason:'Verified export identity with a preserved separate content conflict.'};
  const send=(r,e)=>f.request('POST','/api/v1/imports/linear/bind',{source_workspace_id:source.ids.org,bindings:[{collection:'issues',record:r,target_id:native.id,...(e?{identity_evidence:e}:{})}]});
  expect((await send(record,null)).status).toBe(409);
  for(const mutation of [{id:crypto.randomUUID()},{title:'Another task'},{createdAt:'2020-01-01T00:00:00Z'},{team:{id:crypto.randomUUID()}}])expect((await send({...record,...mutation},proof)).status).toBe(409);
  expect((await send(record,{...proof,native_version:99})).status).toBe(409);
  expect((await send(record,{...proof,native_content_hash:'0'.repeat(64)})).status).toBe(409);
  expect((await f.request('GET','/api/v1/issues/'+native.id)).data.description).toBe('Local');
 }finally{await f.close();}
});
