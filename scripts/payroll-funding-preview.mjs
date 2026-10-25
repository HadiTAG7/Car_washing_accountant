// Disposable, synthetic-only local UI + real pgstore workflow. No production credentials.
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {writeFile} from 'node:fs/promises';
import pg from 'pg';
import config from '../vite.config.js';
import {createStore} from '../server/db/pgstore/index.js';
import {SCHEMA} from '../src/lib/data/schema/registry.js';
import {createPayrollCashFunding} from '../server/payrollCashFunding.js';
import {fundingSeed,fundingPolicy} from '../server/__tests__/payrollCashFundingFixture.js';
if(process.env.PAYROLL_FUNDING_PREVIEW!=='1')throw new Error('Explicit isolated preview flag required');
const url='postgresql://postgres:local-payroll-funding-test-only@127.0.0.1:55437/postgres';
if(new URL(url).hostname!=='127.0.0.1'||new URL(url).port!=='55437')throw new Error('Isolated DB guard');
const pool=new pg.Pool({connectionString:url}),db=createStore({connectionString:url,role:'ledger_server',max:8});
const auth={uid:'11111111-1111-4111-8111-111111111111'};
const names=[...new Set([...SCHEMA.map(t=>t.table),...SCHEMA.filter(t=>t.lines).map(t=>t.lines),'firebase_uid_map'])];
await pool.query(`truncate ${names.map(n=>`public."${n}"`).join(', ')} cascade`);
const batch=db.batch();for(let [path,value]of Object.entries(fundingSeed())){
  path=path.replace('users/funding-admin',`users/${auth.uid}`).replace('users/other-admin','users/22222222-2222-4222-8222-222222222222');batch.set(db.doc(path),value);
}await batch.commit();await pool.end();
const fixture=fileURLToPath(new URL('./payroll-funding-preview/seam.jsx',import.meta.url));
await writeFile(new URL('./payroll-funding-preview/synthetic-policy.js',import.meta.url),'export const PAYROLL_CASH_FUNDING='+JSON.stringify(fundingPolicy)+';');
const base=await config({mode:'development',command:'serve'}),run=createPayrollCashFunding(fundingPolicy);
const server=await createServer({...base,configFile:false,resolve:{alias:[
  {find:/^\.\.\/lib\/payrollCashFundingPolicy$/,replacement:fileURLToPath(new URL('./payroll-funding-preview/synthetic-policy.js',import.meta.url))},
  {find:/^\.\.\/(hooks\/useFinanceRead|lib\/financeApi)$/,replacement:fixture},...base.resolve.alias]},
  plugins:[...base.plugins,{name:'isolated-correction-api',configureServer(vite){
    vite.middlewares.use('/__payroll-funding',async(req,res)=>{
      if(req.method!=='POST'||req.headers.origin!=='http://127.0.0.1:5254'){res.statusCode=403;res.end();return;}
      let body='';for await(const chunk of req){body+=chunk;if(body.length>64000){res.statusCode=413;res.end();return;}}
      res.setHeader('Content-Type','application/json');
      try{res.end(JSON.stringify({result:await run(db,auth,JSON.parse(body))}));}catch(e){res.statusCode=400;res.end(JSON.stringify({error:e.message}));}
    });
  }}],server:{host:'127.0.0.1',port:5254,strictPort:true}});
await server.listen();server.printUrls();
