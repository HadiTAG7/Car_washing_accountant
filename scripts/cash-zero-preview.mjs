// Disposable, synthetic-only local UI + real pgstore workflow. No production credentials.
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import config from '../vite.config.js';
import {createStore} from '../server/db/pgstore/index.js';
import {SCHEMA} from '../src/lib/data/schema/registry.js';
import {createCashResidualCorrection} from '../server/cashResidualCorrection.js';
import {residualSeed,residualPolicies} from '../server/__tests__/cashResidualFixture.js';
if(process.env.CASH_ZERO_PREVIEW!=='1')throw new Error('Explicit isolated preview flag required');
const url='postgresql://postgres:local-cash-zero-test-only@127.0.0.1:55438/postgres';
if(new URL(url).hostname!=='127.0.0.1'||new URL(url).port!=='55438')throw new Error('Isolated DB guard');
const pool=new pg.Pool({connectionString:url}),db=createStore({connectionString:url,role:'ledger_server',max:8});
const auth={uid:'11111111-1111-4111-8111-111111111111'};
const names=[...new Set([...SCHEMA.map(t=>t.table),...SCHEMA.filter(t=>t.lines).map(t=>t.lines),'firebase_uid_map'])];
await pool.query(`truncate ${names.map(n=>`public."${n}"`).join(', ')} cascade`);
const batch=db.batch();for(let [path,value]of Object.entries(residualSeed())){
  path=path.replace('users/funding-admin',`users/${auth.uid}`).replace('users/other-admin','users/22222222-2222-4222-8222-222222222222');batch.set(db.doc(path),value);
}await batch.commit();await pool.end();
const fixture=fileURLToPath(new URL('./cash-zero-preview/seam.jsx',import.meta.url));

const base=await config({mode:'development',command:'serve'}),runs=new Map(residualPolicies.map(p=>[p.reference,createCashResidualCorrection(p)]));
const run=(db,auth,request)=>{const handle=runs.get(request.sourceId);if(!handle)throw Error('Unknown isolated reference');return handle(db,auth,request);};
const server=await createServer({...base,configFile:false,resolve:{alias:[
  {find:/^\.\.\/(hooks\/useFinanceRead|lib\/financeApi)$/,replacement:fixture},...base.resolve.alias]},
  plugins:[...base.plugins,{name:'isolated-correction-api',configureServer(vite){
    vite.middlewares.use('/__cash-zero',async(req,res)=>{
      if(req.method!=='POST'||req.headers.origin!=='http://127.0.0.1:5255'){res.statusCode=403;res.end();return;}
      let body='';for await(const chunk of req){body+=chunk;if(body.length>64000){res.statusCode=413;res.end();return;}}
      res.setHeader('Content-Type','application/json');
      try{res.end(JSON.stringify({result:await run(db,auth,JSON.parse(body))}));}catch(e){res.statusCode=400;res.end(JSON.stringify({error:e.message}));}
    });
  }}],server:{host:'127.0.0.1',port:5255,strictPort:true}});
await server.listen();server.printUrls();
