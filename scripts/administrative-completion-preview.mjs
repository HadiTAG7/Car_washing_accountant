// Synthetic browser fixture only. Every server transport is replaced.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import config from '../vite.config.js';
import { memoryFinanceDb } from '../server/__tests__/financeFixtures.js';
import { completionFixture } from '../functions/test/administrativeCompletionFixture.js';
import { previewAdministrativeCompletion, saveAdministrativeCompletion } from '../functions/src/sweater/administrativeCompletion.js';
const db = memoryFinanceDb({ 'users/admin': { role: 'admin' },
  'bikers/worker1': { name: 'Synthetic one', driver_external_id: '1982', start_date: '2026-08-01' },
  'bikers/worker2': { name: 'Synthetic two', driver_external_id: '2009', start_date: '2026-08-01' } });
const payload = completionFixture(), preview = await previewAdministrativeCompletion(db, payload, 'admin');
await saveAdministrativeCompletion(db, { serverTimestamp: () => 'TEST-SYNTHETIC-TIMESTAMP' }, {
  payload, reviewedPayloadHash: preview.reviewedPayloadHash, previewStateHash: preview.previewStateHash }, 'admin');
const base = await config({ mode:'development',command:'serve' });
const fixture=fileURLToPath(new URL('./administrative-completion-preview/data.js',import.meta.url));
const server=await createServer({...base,configFile:false,plugins:[...base.plugins,{name:'read-only-completion-verification',configureServer(vite){
  vite.middlewares.use('/__completion-readback',async(req,res)=>{
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
    if(req.method!=='POST'||req.headers.host!=='127.0.0.1:5224'){res.statusCode=403;res.end('{}');return;}
    try{let body='';for await(const chunk of req){body+=chunk;if(body.length>64000)throw new Error('TEST payload too large');}
      const result=await previewAdministrativeCompletion(db,JSON.parse(body),'admin');
      console.log(JSON.stringify({readOnly:true,verified:result.verification?.matched,rows:result.verification?.total}));
      res.end(JSON.stringify({result}));
    }catch(error){res.statusCode=400;res.end(JSON.stringify({error:error.message}));}
  });
}}],resolve:{alias:[{find:/^(\.\.\/|\.\.\/\.\.\/)(lib\/firebaseClient|hooks\/useSweaterWashDetails)$/,replacement:fixture},...base.resolve.alias]},server:{host:'127.0.0.1',port:5224,strictPort:true}});
await server.listen();server.printUrls();
