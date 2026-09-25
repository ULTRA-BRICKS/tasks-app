import {targetId} from '../../../imports/linear-source.mjs';
// Only lifecycle/conflict metadata is exposed. Stored source bodies, write intents and credentials never enter the UI.
export async function withSourceState(tx,workspace,collection,rows){
 if(!rows.length)return rows;
 const byTarget=new Map();
 for(let start=0;start<rows.length;start+=100){
  const ids=rows.slice(start,start+100).map(row=>row.id);
  const mappings=await tx.all(`SELECT source_id,target_id FROM linear_source_map WHERE workspace_id=? AND collection=? AND target_id IN (${ids.map(()=>'?').join(',')})`,[workspace,collection,...ids]);
  if(!mappings.length)continue;
  const stateIds=mappings.map(m=>targetId(workspace,'linear-managed-v1','entity-state',collection+':'+m.source_id));
  const states=await tx.all(`SELECT payload FROM outbox WHERE workspace_id=? AND provider='linear' AND status='state' AND id IN (${stateIds.map(()=>'?').join(',')})`,[workspace,...stateIds]);
  const values=new Map(states.map(s=>{const v=JSON.parse(s.payload);return [v.sourceId,v];}));
  for(const m of mappings){const state=values.get(m.source_id);byTarget.set(m.target_id,{provider:'linear',source_id:m.source_id,removed_at:state?.removedAt??null,conflicts:Object.keys(state?.conflicts??{}),last_synced_at:state?.lastAppliedAt??null});}
 }
 return rows.map(row=>({...row,source_sync:byTarget.get(row.id)??null}));
}
