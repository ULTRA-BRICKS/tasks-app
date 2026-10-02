import {isUuid} from './core.mjs';
export class RemoteFault extends Error {
  constructor(provider,code,status=0,{retryAt=null,ambiguous=false}={}){
    super(provider+' operation failed: '+code);this.code=code;this.status=status;this.retryAt=retryAt;this.ambiguous=ambiguous;
  }
}
async function limitedJson(response){
  const reader=response.body?.getReader();if(!reader)throw Error('Empty API response');
  const chunks=[];let size=0;
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>20*1024*1024)throw Error('API response exceeded size limit');chunks.push(Buffer.from(part.value));}}
  finally{reader.releaseLock();}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export class BridgeApi {
  constructor(config,{fetcher=fetch,deadline=Date.now()+540000}={}){
    const origin=new URL(config.tasksOrigin);
    if(origin.protocol!=='https:' || origin.origin!==config.tasksOrigin || origin.username || origin.password || !isUuid(config.workspace) || !isUuid(config.organization))throw Error('Invalid bridge scope');
    if(!config.tasksToken || !config.linearToken)throw Error('Both API credentials are required');
    this.config=config;this.fetcher=fetcher;this.deadline=deadline;this.ready=false;this.calls=0;
  }
  async request(provider,url,options,write){
    if(write && !this.ready)throw Error('Check connected identities before writing');
    const remaining=this.deadline-Date.now();if(remaining<1000)throw new RemoteFault(provider,'RUN_DEADLINE');
    let response;
    try{response=await this.fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(Math.max(1,Math.min(15000,remaining)))});this.calls++;}
    catch{throw new RemoteFault(provider,'TRANSPORT',0,{ambiguous:write});}
    let data;try{data=await limitedJson(response);}catch{throw new RemoteFault(provider,'INVALID_RESPONSE',response.status,{ambiguous:write});}
    const errors=Array.isArray(data?.errors)?data.errors:[];
    if(!response.ok || errors.length || data?.error){
      const raw=errors[0]?.extensions?.code ?? data?.error?.code ?? ('HTTP_'+response.status);
      const code=typeof raw==='string' && /^[A-Z0-9_]{1,80}$/.test(raw)?raw:'API_REJECTED';
      const retry=response.headers.get('retry-after');
      const retryAt=retry && /^\d+$/.test(retry)?Date.now()+Number(retry)*1000:retry?Date.parse(retry):null;
      throw new RemoteFault(provider,code,response.status,{retryAt:Number.isFinite(retryAt)?retryAt:null,ambiguous:write && response.status>=500});
    }
    return data;
  }
  tasks(method,path,data,options={}){
    if(!path.startsWith('/api/') || new URL(path,this.config.tasksOrigin).origin!==this.config.tasksOrigin)throw Error('Invalid Tasks API route');
    return this.request('Tasks',this.config.tasksOrigin+path,{method,headers:{authorization:'Bearer '+this.config.tasksToken,'content-type':'application/json',...(options.idempotencyKey?{'idempotency-key':options.idempotencyKey}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})},options.readOnly?false:!['GET','HEAD'].includes(method));
  }
  linear(query,variables={}){
    const write=/^\s*mutation\b/.test(query);
    return this.request('Linear','https://api.linear.app/graphql',{method:'POST',headers:{authorization:this.config.linearToken,'content-type':'application/json'},body:JSON.stringify({query,variables})},write).then(result=>{
      if(!result.data || typeof result.data!=='object')throw new RemoteFault('Linear','MISSING_DATA');return result.data;
    });
  }
  async checkIdentity(){
    this.ready=false;
    const me=await this.tasks('GET','/api/v1/me');
    const source=await this.linear('query BridgeIdentity { organization { id } viewer { id } }');
    if(me.workspace_id!==this.config.workspace || !['owner','admin','member'].includes(me.role) || !me.scopes?.includes('write') || source.organization?.id!==this.config.organization)throw Error('Connected identities do not match the configured writable scopes');
    this.ready=true;return {nativeUser:me.id,sourceUser:source.viewer.id};
  }
  async collection(name,fields,{filter=null,pageSize=100,native=false}={}){
    if(!/^[A-Za-z]+$/.test(name) || !Number.isInteger(pageSize) || pageSize<1 || pageSize>100)throw Error('Invalid collection request');
    const filterType=name==='issues'?'IssueFilter':name==='comments'?'CommentFilter':null;
    if(filter && !filterType)throw Error('Unsupported collection filter');
    const query=`query BridgePage($after:String${filter?',$filter:'+filterType:''}){${name}(first:${pageSize},after:$after,includeArchived:true${filter?',filter:$filter':''}){nodes{${fields}}pageInfo{hasNextPage endCursor}}}`;
    const rows=[],ids=new Set(),cursors=new Set();let after=null;
    for(let pageNumber=0;pageNumber<1000;pageNumber++){
      const variables={after,...(filter?{filter}:{})};
      const data=native?await this.tasks('POST','/api/graphql',{query,variables},{readOnly:true}).then(r=>{if(r.errors?.length)throw new RemoteFault('Tasks','GRAPHQL_ERROR');return r.data;}):await this.linear(query,variables);
      const page=data?.[name];
      if(!Array.isArray(page?.nodes) || typeof page.pageInfo?.hasNextPage!=='boolean')throw Error('Incomplete collection page');
      for(const row of page.nodes){if(!row?.id || ids.has(row.id))throw Error('Duplicate or missing collection identity');ids.add(row.id);rows.push(row);}
      if(!page.pageInfo.hasNextPage)return rows;
      after=page.pageInfo.endCursor;
      if(typeof after!=='string' || !after || cursors.has(after))throw Error('Repeated or missing page cursor');cursors.add(after);
    }
    throw Error('Collection exceeds the pagination budget');
  }
  async nativeIssues(){
    const rows=[],ids=new Set();
    for(const archived of [false,true])for(const deleted of [false,true]){
      let cursor=null;const seen=new Set();
      do{const query=new URLSearchParams({limit:'200',archived:String(archived),deleted:String(deleted),...(cursor?{cursor}:{})});
        const page=await this.tasks('GET','/api/v1/issues?'+query);if(!Array.isArray(page.data))throw Error('Invalid Tasks issue page');
        for(const row of page.data){if(!row?.id || ids.has(row.id))throw Error('Duplicate native issue');ids.add(row.id);rows.push(row);}
        cursor=page.next_cursor;if(cursor){if(seen.has(cursor)||seen.size>=1000)throw Error('Repeated native cursor');seen.add(cursor);}
      }while(cursor);
    }return rows;
  }
}
