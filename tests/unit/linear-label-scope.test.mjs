import {test,expect} from 'bun:test';
import {configured} from './linear-live-queue.test.mjs';
import {referenceResolver,registerSource,loadNative} from '../../packages/server/modules/linear-live/context.mjs';
import {targetId} from '../../packages/imports/linear-source.mjs';
async function setup(){
 const f=await configured();
 f.labelId=targetId(f.config.workspaceId,f.source.ids.org,'issueLabels',f.source.ids.label);
 f.issueId=targetId(f.config.workspaceId,f.source.ids.org,'issues',f.source.ids.issue);
 return f;
}
const add=(f,id,team)=>f.f.db.transaction(tx=>registerSource(tx,f.config,'issueLabels',{...f.source.data.issueLabels[0],id,team:team?{id:team}:null},f.labelId));
const resolver=f=>f.f.db.transaction(async tx=>referenceResolver(tx,f.config,'issues',null,null,await loadNative(tx,f.config,'issues',f.issueId)));
test('outbound issue cannot use a source label that belongs only to another team',async()=>{
 const f=await setup();try{
  await add(f,f.source.ids.label,crypto.randomUUID());
  const r=await resolver(f);
  expect(()=>r.reverse('issueLabels',f.labelId)).toThrow();
 }finally{await f.f.close();}
});
test('outbound issue selects its own team alias rather than the first label mapping',async()=>{
 const f=await setup();try{
  await add(f,f.source.ids.label,crypto.randomUUID());
  const correct=crypto.randomUUID();await add(f,correct,f.source.ids.team);
  const r=await resolver(f);expect(r.reverse('issueLabels',f.labelId)).toBe(correct);
 }finally{await f.f.close();}
});
test('a verified workspace label is usable across teams but competing same-team aliases are refused',async()=>{
 const f=await setup();try{
  await add(f,f.source.ids.label,null);
  expect((await resolver(f)).reverse('issueLabels',f.labelId)).toBe(f.source.ids.label);
  const one=crypto.randomUUID(),two=crypto.randomUUID();
  await add(f,one,f.source.ids.team);await add(f,two,f.source.ids.team);
  expect(()=>(f.cached).reverse('issueLabels',f.labelId)).toThrow();
 }finally{await f.f.close();}
});
