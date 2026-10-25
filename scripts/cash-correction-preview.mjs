// Disposable, synthetic-only local UI + real pgstore workflow. No production credentials.
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {writeFile} from 'node:fs/promises';
import pg from 'pg';
import config from '../vite.config.js';
import {createStore} from '../server/db/pgstore/index.js';
import {SCHEMA} from '../src/lib/data/schema/registry.js';
import {createCashBankCorrection} from '../server/cashBankCorrection.js';
import {correctionSeed,correctionPolicy,correctionSources} from '../server/__tests__/cashBankCorrectionFixture.js';
if(process.env.CASH_CORRECTION_PREVIEW!=='1')throw new Error('Explicit isolated preview flag required');
const url='postgresql://postgres:local-cash-test-only@127.0.0.1:55436/postgres';
if(new URL(url).hostname!=='127.0.0.1'||new URL(url).port!=='55436')throw new Error('Isolated DB guard');
const pool=new pg.Pool({connectionString:url}),db=createStore({connectionString:url,role:'ledger_server',max:8});
const auth={uid:'11111111-1111-4111-8111-111111111111'};
const names=[...new Set([...SCHEMA.map(t=>t.table),...SCHEMA.filter(t=>t.lines).map(t=>t.lines),'firebase_uid_map'])];
await pool.query(`truncate ${names.map(n=>`public."${n}"`).join(', ')} cascade`);
const batch=db.batch();for(let [path,value]of Object.entries(correctionSeed())){
  path=path.replace('users/correction-admin',`users/${auth.uid}`).replace('users/another-admin','users/22222222-2222-4222-8222-222222222222');batch.set(db.doc(path),value);
}await batch.commit();await pool.end();
const fixture=fileURLToPath(new URL('./cash-correction-preview/seam.jsx',import.meta.url));
await writeFile(new URL('./cash-correction-preview/synthetic-sources.json',import.meta.url),JSON.stringify({sources:correctionSources}));
const base=await config({mode:'development',command:'serve'}),run=createCashBankCorrection(correctionPolicy);
const server=await createServer({...base,configFile:false,resolve:{alias:[
  {find:/^\.\.\/(hooks\/useFinanceRead|lib\/financeApi)$/,replacement:fixture},...base.resolve.alias]},
  plugins:[...base.plugins,{name:'isolated-correction-api',configureServer(vite){
    vite.middlewares.use('/__cash-correction',async(req,res)=>{
      if(req.method!=='POST'||req.headers.origin!=='http://127.0.0.1:5253'){res.statusCode=403;res.end();return;}
      let body='';for await(const chunk of req){body+=chunk;if(body.length>64000){res.statusCode=413;res.end();return;}}
      res.setHeader('Content-Type','application/json');
      try{res.end(JSON.stringify({result:await run(db,auth,JSON.parse(body))}));}catch(e){res.statusCode=400;res.end(JSON.stringify({error:e.message}));}
    });
  }}],server:{host:'127.0.0.1',port:5253,strictPort:true}});
await server.listen();server.printUrls();
