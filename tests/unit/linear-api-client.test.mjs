import {test,expect} from 'bun:test';
import {BridgeApi} from '../../packages/linear-bridge/client.mjs';
const config={tasksOrigin:'https://tasks.example.test',workspace:'00000000-0000-4000-8000-000000000001',organization:'00000000-0000-4000-8000-000000000002',tasksToken:'synthetic-tasks-token',linearToken:'synthetic-linear-token'};
const response=value=>Response.json(value);
test('a bridge refuses writes until both connected identities have been checked',async()=>{
  const calls=[];const api=new BridgeApi(config,{fetcher:async(url,options)=>{calls.push({url,options});return url.endsWith('/me')?response({workspace_id:config.workspace,role:'owner',scopes:['read','write']}):response({data:{organization:{id:config.organization},viewer:{id:'viewer'}}});}});
  await expect(api.linear('mutation { issueCreate { success } }',{})).rejects.toThrow('identities');
  expect(calls).toHaveLength(0);
  await api.checkIdentity();expect(calls).toHaveLength(2);
  expect(calls[0].options.headers.authorization).toBe('Bearer '+config.tasksToken);
  expect(calls[1].options.headers.authorization).toBe(config.linearToken);
  expect(calls.every(call=>call.options.redirect==='error')).toBe(true);
});
test('a mismatched organization or read-only Tasks token cannot authorize changes',async()=>{
  const api=new BridgeApi(config,{fetcher:async(url)=>url.endsWith('/me')?response({workspace_id:config.workspace,role:'viewer',scopes:['read']}):response({data:{organization:{id:'different'}}})});
  await expect(api.checkIdentity()).rejects.toThrow();
  await expect(api.tasks('POST','/api/v1/issues',{})).rejects.toThrow('identities');
});
test('HTTP200 GraphQL errors are not accepted as empty or successful results',async()=>{
  const api=new BridgeApi(config,{fetcher:async()=>response({data:{issues:null},errors:[{message:'private-token-value',extensions:{code:'FORBIDDEN'}}]})});
  try{await api.linear('query { issues { nodes { id } } }',{});throw Error('Expected failure');}
  catch(error){expect(error.code).toBe('FORBIDDEN');expect(error.message).not.toContain('private-token-value');}
});
test('collection pagination rejects a repeated cursor rather than looping or truncating',async()=>{
  const api=new BridgeApi(config,{fetcher:async()=>response({data:{issues:{nodes:[{id:'same'}],pageInfo:{hasNextPage:true,endCursor:'again'}}}})});
  await expect(api.collection('issues','id')).rejects.toThrow();
});
