import { createDatabase } from '../packages/db/index.mjs';
import { createApp } from '../packages/server/app.mjs';
import { nodeHandler } from '../packages/server/node-adapter.mjs';
let handler;
export default async function(req,res) {
  try{
    handler??=(async()=>nodeHandler(createApp({db:await createDatabase({url:process.env.DATABASE_URL,production:true})}),process.env.APP_URL))();
    return (await handler)(req,res);
  }catch{res.statusCode=503;res.setHeader('content-type','application/json');res.end(JSON.stringify({error:{code:'NOT_CONFIGURED',message:'Production configuration is incomplete'}}));}
}
