import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Actor, Catalog } from '@tickets/contracts';
import { NewIssuePage } from '../../../src/pages/issue-new/state-lib';
import { UiStateProvider } from '../../../src/shared/lib/state/local';
import { createUiRegistry } from '../../../src/shared/lib/state/ui-registry';
import '../../../src/app/styles.css';
const client = new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
const actor = (id: string): Actor => ({id,workspace_id:'synthetic-workspace',name:id,email:id+'@example.invalid',role:'owner',scopes:[],auth_type:'session'});
const catalog: Catalog = {workspace:{id:'synthetic-workspace',name:'Synthetic',slug:'synthetic'},teams:[{id:'team',workspace_id:'synthetic-workspace',key:'SYN',name:'Synthetic'}],statuses:[{id:'todo',team_id:'team',name:'Todo',category:'unstarted',color:'#888',position:0}],labels:[],people:[],modules:[]};
client.setQueryData(['me'],actor('first'));
client.setQueryData(['catalog'],catalog);
for (const key of ['projects','cycles','milestones','views']) client.setQueryData([key],[]);
const registry=createUiRegistry();
function Fixture(){return <>
  <div style={{display:'flex',gap:12,padding:12}}>
    <button id="first" onClick={()=>client.setQueryData(['me'],actor('first'))}>First account</button>
    <button id="second" onClick={()=>client.setQueryData(['me'],actor('second'))}>Second account</button>
    <button id="waiting" onClick={()=>client.removeQueries({queryKey:['me'],exact:true})}>Clear identity</button>
  </div>
  <NewIssuePage/>
</>;}
createRoot(document.getElementById('root')!).render(<StrictMode><QueryClientProvider client={client}><UiStateProvider registry={registry}><MemoryRouter initialEntries={['/issues/new']}><Fixture/></MemoryRouter></UiStateProvider></QueryClientProvider></StrictMode>);
