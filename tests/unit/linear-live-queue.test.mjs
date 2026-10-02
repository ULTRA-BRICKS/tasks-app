import {test,expect} from 'bun:test';
import {fixture} from './helpers.mjs';
import {sourceFixture} from './linear-import-fixture.mjs';
import {hmac} from '../../packages/server/core/crypto.mjs';
import {configureSync,readSyncConfig,enqueueSyncJob,claimSyncJob,finishSyncJob,failSyncJob,readSyncStatus} from '../../packages/server/modules/linear-live/store.mjs';
import {verifySourceWebhook,receiveSourceWebhook} from '../../packages/server/modules/linear-live/webhook.mjs';
import {runWorker} from '../../packages/server/modules/integrations/service.mjs';
export async function configured(){
 const f=await fixture(),source=sourceFixture();
 const run=(await f.request('POST','/api/v1/imports/linear',{manifest:source.manifest})).data.id;
 for(const [collection,records] of Object.entries(source.data))if(records.length)expect((await f.request('POST',`/api/v1/imports/linear/${run}/records`,{collection,records})).status).toBe(200);
 const plan=(await f.request('POST',`/api/v1/imports/linear/${run}/plan`)).data;
 expect((await f.request('POST',`/api/v1/imports/linear/${run}/apply`,{plan_hash:plan.plan_hash})).status).toBe(200);
 const actor={id:f.init.user_id,workspace_id:f.init.workspace_id,role:'owner',scopes:['read','write','admin']};
 const env={...f.env,LINEAR_SYNC_WORKSPACE_ID:actor.workspace_id,LINEAR_WEBHOOK_SECRET:'synthetic-signing-secret',LINEAR_API_TOKEN:'synthetic-only',VERCEL_DEPLOYMENT_ID:'test-deployment'};
 const config=await f.db.transaction(tx=>configureSync(tx,actor,{organizationId:source.ids.org,enabled:true},env));
 return {f,source,actor,env,config};
}
test('the signed inbox persists a job once and rejects changed replay bodies without overwriting',async()=>{
 const {f,source,env}=await configured();try{
  const delivery=crypto.randomUUID(),payload={type:'Issue',action:'update',organizationId:source.ids.org,createdAt:new Date().toISOString(),webhookTimestamp:Date.now(),data:{id:source.ids.issue}};
  const raw=Buffer.from(JSON.stringify(payload)),headers=new Headers({'linear-signature':hmac(env.LINEAR_WEBHOOK_SECRET,raw),'linear-delivery':delivery});
  const event=verifySourceWebhook(headers,raw,env);
  const first=await f.db.transaction(tx=>receiveSourceWebhook(tx,event,env));
  const second=await f.db.transaction(tx=>receiveSourceWebhook(tx,event,env));
  expect(first.jobId).toBe(second.jobId);expect(second.duplicate).toBe(true);
  const changed={...event,payload:{...payload,data:{id:crypto.randomUUID()}}};
  const mismatch=await f.db.transaction(tx=>receiveSourceWebhook(tx,changed,env));expect(mismatch.mismatch).toBe(true);
  const stored=await f.db.transaction(tx=>tx.all("SELECT * FROM outbox WHERE provider='linear'"));expect(stored).toHaveLength(1);
  expect(JSON.parse(stored[0].payload).sourceId).toBe(source.ids.issue);
 }finally{await f.close();}
});
test('a stale claim or downgraded importer cannot apply or finish a managed sync job',async()=>{
 const {f,source,actor,env,config}=await configured();try{
  const job=await f.db.transaction(tx=>enqueueSyncJob(tx,actor.workspace_id,{kind:'entity',collection:'issues',sourceId:source.ids.issue},'test-job'));
  const first=await claimSyncJob(f.db,env,job.id,config.generation);
  expect(first).not.toBeNull();
  await f.db.transaction(tx=>tx.exec("UPDATE outbox SET next_attempt_at='2000-01-01T00:00:00.000Z' WHERE id=?",[job.id]));
  const second=await claimSyncJob(f.db,env,job.id,config.generation);
  expect(second.attempts).toBe(first.attempts+1);
  await expect(f.db.transaction(tx=>finishSyncJob(tx,first,{ok:true}))).rejects.toThrow();
  await f.db.transaction(tx=>finishSyncJob(tx,second,{ok:true}));
  await failSyncJob(f.db,first,Error('late failed request'));
  expect((await f.db.transaction(tx=>tx.one('SELECT status FROM outbox WHERE id=?',[job.id]))).status).toBe('done');
  await f.db.transaction(tx=>tx.exec("UPDATE memberships SET role='viewer' WHERE workspace_id=? AND user_id=?",[actor.workspace_id,actor.id]));
  await expect(f.db.transaction(tx=>readSyncConfig(tx,env))).rejects.toThrow();
 }finally{await f.close();}
});
test('legacy GitHub/Slack workers never consume Linear jobs',async()=>{
 const {f,actor}=await configured();try{
  await f.db.transaction(tx=>enqueueSyncJob(tx,actor.workspace_id,{kind:'scan',collection:'issues',side:'source'},'queued-scan'));
  await runWorker(f.db,f.env,{limit:1,fetcher:()=>{throw Error('Legacy worker touched Linear');}});
  expect((await f.db.transaction(tx=>tx.one("SELECT status FROM outbox WHERE provider='linear'"))).status).toBe('pending');
 }finally{await f.close();}
});
test('invalid signatures and stale delivery timestamps are rejected before persistence',()=>{
 const env={LINEAR_WEBHOOK_SECRET:'secret',LINEAR_SYNC_WORKSPACE_ID:crypto.randomUUID()};
 expect(()=>verifySourceWebhook(new Headers(),Buffer.from('{}'),env)).toThrow();
 const raw=Buffer.from(JSON.stringify({webhookTimestamp:1,type:'Issue',action:'remove',createdAt:new Date().toISOString(),organizationId:crypto.randomUUID(),data:{id:crypto.randomUUID()}}));
 expect(()=>verifySourceWebhook(new Headers({'linear-signature':hmac('secret',raw),'linear-delivery':crypto.randomUUID()}),raw,env)).toThrow();
});
