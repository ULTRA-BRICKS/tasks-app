import{test,expect}from'bun:test';
import{configured}from'./linear-live-queue.test.mjs';
import{enqueueSyncJob,readEntityState}from'../../packages/server/modules/linear-live/store.mjs';
import{reconcileEntityJob}from'../../packages/server/modules/linear-live/engine.mjs';
import{targetId}from'../../packages/imports/linear-source.mjs';
function upstream(source,record){
 const writes=[];
 const fetcher=async(_url,options)=>{const {query,variables}=JSON.parse(options.body);
  if(query.includes('SyncOrganization'))return Response.json({data:{organization:{id:source.ids.org}}});
  if(query.includes('issueUpdate')){writes.push(variables.input);Object.assign(record,variables.input,{updatedAt:new Date().toISOString()});return Response.json({data:{issueUpdate:{success:true,issue:record}}});}
  if(query.includes('SyncEntity'))return Response.json({data:{issue:record}});
  throw Error('Unexpected source operation');
 };return{fetcher,writes};
}
test('one real domain reconciliation applies independent source/native fields in both directions',async()=>{
 const {f,source,actor,env,config}=await configured();try{
  const sid=source.ids.issue,tid=targetId(actor.workspace_id,source.ids.org,'issues',sid);
  expect((await f.request('PATCH','/api/v1/issues/'+tid,{version:1,title:'Native edit'})).status).toBe(200);
  const remote={...source.data.issues.find(r=>r.id===sid),priority:1,updatedAt:'2026-09-24T00:00:00.000Z'};
  const api=upstream(source,remote),job=await f.db.transaction(tx=>enqueueSyncJob(tx,actor.workspace_id,{kind:'entity',collection:'issues',sourceId:sid,side:'source'},'merge-case'));
  await reconcileEntityJob(f.db,env,job.id,config.generation,{fetcher:api.fetcher});
  const detail=(await f.request('GET','/api/v1/issues/'+tid)).data;
  expect(detail.title).toBe('Native edit');expect(detail.priority).toBe(1);expect(remote.title).toBe('Native edit');expect(api.writes).toHaveLength(1);
  const state=await f.db.transaction(tx=>readEntityState(tx,actor.workspace_id,'issues',sid));expect(state.conflicts).toEqual({});
 }finally{await f.close();}
});
test('conflicting descriptions are retained on both sides and remain inspectable',async()=>{
 const {f,source,actor,env,config}=await configured();try{
  const sid=source.ids.issue,tid=targetId(actor.workspace_id,source.ids.org,'issues',sid);
  await f.request('PATCH','/api/v1/issues/'+tid,{version:1,description:'Native description'});
  const remote={...source.data.issues.find(r=>r.id===sid),description:'Source description',updatedAt:'2026-09-24T00:00:00.000Z'};
  const api=upstream(source,remote),job=await f.db.transaction(tx=>enqueueSyncJob(tx,actor.workspace_id,{kind:'entity',collection:'issues',sourceId:sid,side:'source'},'conflict-case'));
  await reconcileEntityJob(f.db,env,job.id,config.generation,{fetcher:api.fetcher});
  expect((await f.request('GET','/api/v1/issues/'+tid)).data.description).toBe('Native description');expect(remote.description).toBe('Source description');expect(api.writes).toHaveLength(0);
  const state=await f.db.transaction(tx=>readEntityState(tx,actor.workspace_id,'issues',sid));expect(state.conflicts.description.local).toBe('Native description');expect(state.conflicts.description.source).toBe('Source description');
 }finally{await f.close();}
});
