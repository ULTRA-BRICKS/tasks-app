import{test,expect}from'bun:test';
import{requestLinear,readSourceEntity,readSourcePage,SOURCE_MODELS}from'../../packages/server/modules/linear-live/client.mjs';
import{buildSchema,parse,validate}from'graphql';
const env={LINEAR_API_TOKEN:'synthetic-token'};
test('source transport pins its origin, disallows redirects and enforces cancellation',async()=>{
 let called=0;
 const data=await requestLinear(env,'query { organization { id } }',{}, {deadline:Date.now()+5000,fetcher:async(url,options)=>{called++;expect(url).toBe('https://api.linear.app/graphql');expect(options.redirect).toBe('error');expect(options.headers.Authorization).toBe('synthetic-token');expect(options.signal).toBeInstanceOf(AbortSignal);return Response.json({data:{organization:{id:'x'}}});}});
 expect(data.organization.id).toBe('x');expect(called).toBe(1);
 await expect(requestLinear(env,'query { organization { id } }',{}, {deadline:Date.now()-1,fetcher:()=>{throw Error('Must not fetch');}})).rejects.toThrow();
});
test('GraphQL rate limits and inaccessible records are not interpreted as empty successful pages',async()=>{
 let error;try{await requestLinear(env,'query{x}',{}, {fetcher:async()=>Response.json({errors:[{extensions:{code:'RATELIMITED'}}]},{status:400,headers:{'retry-after':'30'}})});}catch(e){error=e;}
 expect(error.code).toBe('SOURCE_RATE_LIMITED');expect(error.retryAfterSeconds).toBe(30);
 await expect(readSourcePage(env,'issues',{}, {fetcher:async()=>Response.json({errors:[{extensions:{code:'FORBIDDEN'}}]})})).rejects.toThrow();
});
test('canonical responses must match the requested UUID and include valid page cursors',async()=>{
 const key=crypto.randomUUID();
 await expect(readSourceEntity(env,'issues',key,{fetcher:async()=>Response.json({data:{issue:{id:crypto.randomUUID()}}})})).rejects.toThrow();
 await expect(readSourcePage(env,'issues',{}, {fetcher:async()=>Response.json({data:{issues:{nodes:[],pageInfo:{hasNextPage:true,endCursor:null}}}})})).rejects.toThrow();
});
test('every supported source query matches the pinned official schema',async()=>{
 const schema=buildSchema(await Bun.file(new URL('../../vendor/linear/schema.graphql',import.meta.url)).text());
 for(const [collection,model]of Object.entries(SOURCE_MODELS)){
  const queries=[];const fetcher=async(_url,options)=>{queries.push(JSON.parse(options.body).query);return Response.json({data:{[model.one]:null,[model.many]:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}}});};
  await readSourceEntity(env,collection,crypto.randomUUID(),{fetcher});await readSourcePage(env,collection,{}, {fetcher});
  for(const query of queries)expect(validate(schema,parse(query)).map(e=>e.message)).toEqual([]);
 }
});
