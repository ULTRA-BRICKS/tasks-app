import { test, expect } from 'bun:test';
import { fixture } from './helpers.mjs';
import { sourceFixture } from './linear-import-fixture.mjs';
import { targetId } from '../../packages/imports/linear-source.mjs';
function navigationSource(email = 'owner@example.test') {
  const source = sourceFixture(),
    { data, ids, manifest } = source;
  data.users[0].email = email;
  const time = {
    createdAt: data.users[0].createdAt,
    updatedAt: data.users[0].updatedAt,
    archivedAt: null,
  };
  data.customViews = [
    {
      id: crypto.randomUUID(),
      name: 'Source project view',
      modelName: 'Issue',
      shared: true,
      owner: { id: ids.user },
      creator: { id: ids.user },
      team: { id: ids.team },
      filterData: {
        and: [{ project: { id: { in: [ids.project] } } }, { state: { name: { in: ['Todo'] } } }],
      },
      ...time,
    },
  ];
  data.favorites = [
    {
      id: crypto.randomUUID(),
      type: 'issue',
      owner: { id: ids.user },
      issue: { id: ids.issue },
      parent: null,
      sortOrder: 4,
      ...time,
    },
  ];
  manifest.counts = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length]));
  return source;
}
async function importSource(f, s) {
  const create = await f.request('POST', '/api/v1/imports/linear', { manifest: s.manifest });
  expect(create.status).toBe(201);
  const run = create.data.id;
  for (const [collection, records] of Object.entries(s.data))
    if (records.length) {
      const result = await f.request('POST', `/api/v1/imports/linear/${run}/records`, {
        collection,
        records,
      });
      expect(result.status).toBe(200);
    }
  const plan = await f.request('POST', `/api/v1/imports/linear/${run}/plan`);
  if (plan.status !== 200) return { run, plan };
  const apply = await f.request('POST', `/api/v1/imports/linear/${run}/apply`, {
    plan_hash: plan.data.plan_hash,
  });
  expect(apply.status).toBe(200);
  return { run, plan, apply };
}
test('imports functional multi-project/status views and personal favorites without duplicates', async () => {
  const f = await fixture(),
    s = navigationSource();
  try {
    const { run, plan } = await importSource(f, s);
    expect(plan.status).toBe(200);
    const views = await f.request('GET', '/api/v1/views');
    expect(views.data).toHaveLength(1);
    const filters = views.data[0].filters;
    expect(filters.team_id).toBe(targetId(f.init.workspace_id, s.ids.org, 'teams', s.ids.team));
    expect(filters.project_ids).toEqual([
      targetId(f.init.workspace_id, s.ids.org, 'projects', s.ids.project),
    ]);
    expect(filters.status_ids).toEqual([
      targetId(f.init.workspace_id, s.ids.org, 'workflowStates', s.ids.state),
    ]);
    const issues = await f.request(
      'GET',
      '/api/v1/issues?' +
        new URLSearchParams(Object.entries(filters).map(([k, v]) => [k, String(v)])),
    );
    expect(issues.status).toBe(200);
    expect(issues.data.data).toHaveLength(2);
    const favorites = await f.request('GET', '/api/v1/favorites');
    expect(favorites.status).toBe(200);
    expect(favorites.data).toHaveLength(1);
    expect(favorites.data[0].title).toBe('Parent');
    expect(favorites.data[0].href).toBe(
      '/issues/' + targetId(f.init.workspace_id, s.ids.org, 'issues', s.ids.issue),
    );
    expect(
      (
        await f.request('POST', `/api/v1/imports/linear/${run}/apply`, {
          plan_hash: plan.data.plan_hash,
        })
      ).status,
    ).toBe(200);
    expect((await f.request('GET', '/api/v1/favorites')).data).toHaveLength(1);
  } finally {
    await f.close();
  }
});
test('unmapped personal favorites stay private and do not create accounts', async () => {
  const f = await fixture(),
    s = navigationSource('not-a-member@example.test');
  try {
    const { plan } = await importSource(f, s);
    expect(plan.status).toBe(200);
    expect((await f.request('GET', '/api/v1/favorites')).data).toHaveLength(0);
    const counts = await f.db.transaction((tx) =>
      tx.one(
        'SELECT (SELECT COUNT(*) FROM favorites) AS favorites,(SELECT COUNT(*) FROM users) AS users',
      ),
    );
    expect(Number(counts.favorites)).toBe(1);
    expect(Number(counts.users)).toBe(1);
    expect(
      (await f.request('GET', '/api/v1/favorites', undefined, { anonymous: true })).status,
    ).toBe(401);
  } finally {
    await f.close();
  }
});
test('unsupported view filters block import instead of broadening results', async () => {
  const f = await fixture(),
    s = navigationSource();
  s.data.customViews[0].filterData = { or: [{ priority: { eq: 1 } }] };
  try {
    const { plan } = await importSource(f, s);
    expect(plan.status).toBe(422);
    const count = await f.db.transaction((tx) => tx.one('SELECT COUNT(*) AS n FROM issues'));
    expect(Number(count.n)).toBe(0);
  } finally {
    await f.close();
  }
});
test('empty IN filters match nothing and malformed identifiers are rejected', async () => {
  const f = await fixture();
  try {
    await f.create();
    const empty = await f.request('GET', '/api/v1/issues?project_ids=');
    expect(empty.status).toBe(200);
    expect(empty.data.data).toHaveLength(0);
    expect((await f.request('GET', '/api/v1/issues?project_ids=not-a-uuid')).status).toBe(422);
  } finally {
    await f.close();
  }
});

test('favorite API preserves owner privacy, validates targets, and retries without duplicates', async () => {
  const f = await fixture();
  try {
    const issue = (await f.create({ title: 'Private favorite target' })).data;
    const first = await f.request('POST', '/api/v1/favorites', {
      target_type: 'issue',
      target_id: issue.id,
    });
    expect(first.status).toBe(201);
    const again = await f.request('POST', '/api/v1/favorites', {
      target_type: 'issue',
      target_id: issue.id,
    });
    expect(again.data.id).toBe(first.data.id);
    expect((await f.request('GET', '/api/v1/favorites')).data).toHaveLength(1);
    const other = crypto.randomUUID(),
      privateView = crypto.randomUUID(),
      privateFavorite = crypto.randomUUID(),
      time = new Date().toISOString();
    await f.db.transaction(async (tx) => {
      await tx.exec('INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)', [
        other,
        'other@example.test',
        'Other synthetic user',
        'not-a-login-hash',
        time,
      ]);
      await tx.exec('INSERT INTO memberships(workspace_id,user_id,role) VALUES(?,?,?)', [
        f.init.workspace_id,
        other,
        'member',
      ]);
      await tx.exec(
        'INSERT INTO saved_views(id,workspace_id,owner_id,name,filters,shared,created_at) VALUES(?,?,?,?,?,?,?)',
        [privateView, f.init.workspace_id, other, 'Private other view', '{}', 0, time],
      );
      await tx.exec(
        'INSERT INTO favorites(id,workspace_id,owner_id,target_type,target_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
        [privateFavorite, f.init.workspace_id, other, 'issue', issue.id, time, time],
      );
    });
    expect((await f.request('GET', '/api/v1/favorites')).data.map((x) => x.id)).toEqual([
      first.data.id,
    ]);
    expect((await f.request('DELETE', '/api/v1/favorites/' + privateFavorite)).status).toBe(404);
    expect(
      (
        await f.request('POST', '/api/v1/favorites', {
          target_type: 'customView',
          target_id: privateView,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await f.request('POST', '/api/v1/favorites', {
          target_type: 'issue',
          target_id: crypto.randomUUID(),
        })
      ).status,
    ).toBe(404);
    expect((await f.request('DELETE', '/api/v1/favorites/' + first.data.id)).status).toBe(200);
    expect((await f.request('GET', '/api/v1/favorites')).data).toHaveLength(0);
  } finally {
    await f.close();
  }
});

test('source navigation obeys native ownership and shared-view visibility', async () => {
  const f = await fixture(), source = navigationSource();
  source.data.customViews[0].shared = false;
  try {
    const {plan} = await importSource(f, source);
    expect(plan.status).toBe(200);
    const viewPath='/api/v1/imported-source/customViews/'+source.data.customViews[0].id;
    const favoritePath='/api/v1/imported-source/favorites/'+source.data.favorites[0].id;
    expect((await f.request('GET',viewPath)).status).toBe(200);
    expect((await f.request('GET',favoritePath)).status).toBe(200);
    await f.db.transaction(async tx=>{
      await tx.exec('UPDATE saved_views SET owner_id=NULL WHERE id=?',['nonexistent']);
      await tx.exec('UPDATE favorites SET owner_id=NULL WHERE workspace_id=?',[f.init.workspace_id]);
      await tx.exec('UPDATE memberships SET role=? WHERE workspace_id=? AND user_id=?',['viewer',f.init.workspace_id,f.init.user_id]);
    });
    expect((await f.request('GET',favoritePath)).status).toBe(404);
    expect((await f.request('GET',viewPath)).status).toBe(200);
  } finally {await f.close();}
});
test('repeated array query parameters retain every requested project',async()=>{
  const f=await fixture();try{
    const first=(await f.request('POST','/api/v1/projects',{name:'First',team_ids:[f.init.team_id]})).data;
    const second=(await f.request('POST','/api/v1/projects',{name:'Second',team_ids:[f.init.team_id]})).data;
    await f.create({project_id:first.id});await f.create({project_id:second.id});
    const result=await f.request('GET','/api/v1/issues?project_ids='+first.id+'&project_ids='+second.id);
    expect(result.status).toBe(200);expect(result.data.data).toHaveLength(2);
  }finally{await f.close();}
});
