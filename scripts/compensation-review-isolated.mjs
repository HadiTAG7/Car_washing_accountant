const { default: EmbeddedPostgres } = await import(process.env.COMPENSATION_TEST_PG_MODULE || 'embedded-postgres');
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer as createViteServer } from 'vite';
import { createStore } from '../server/db/pgstore/index.js';
import { compensationReview } from '../functions/src/compensationReview.js';
import { reviewSource, owner } from '../functions/test/compensationReviewFixture.js';
const port=55731, webPort=55732, name='compensation_review_isolated_20261101';
const target=resolve(process.env.COMPENSATION_TEST_PG_DIR || '.test-runtime/compensation-review-pg-'+Date.now());
await mkdir(target,{recursive:true});
const pg=new EmbeddedPostgres({databaseDir:target,port,user:'postgres',password:'isolated-only',persistent:true,
  initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
await pg.initialise();await pg.start();
const admin=pg.getPgClient();await admin.connect();await admin.query('CREATE DATABASE '+name);await admin.end();
const dbUrl='postgresql://postgres:isolated-only@127.0.0.1:'+port+'/'+name;
const check=new URL(dbUrl);if(check.hostname!=='127.0.0.1'||check.pathname!=='/'+name) throw Error('Isolation guard');
const {default:pgClient}=await import('pg'),pool=new pgClient.Pool({connectionString:dbUrl});
await pool.query(`CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN;CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,deleted_at timestamptz,banned_until timestamptz);
CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,not_after timestamptz);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated,service_role;GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,service_role;`);
for(const filename of ['20261022000000_foundation.sql','20261022000100_tables.sql','20261022000200_ledger.sql','20261022000300_security.sql','20261022000400_browser_api.sql','20261026210339_quality_objections.sql']){
  await pool.query(await readFile('supabase/migrations/'+filename,'utf8'));
}
const db=createStore({connectionString:dbUrl,role:'ledger_server',max:4});
const pgActor={uid:'99999999-2222-4222-8222-222222222222',token:{email:'synthetic-agent@example.test'}};
for(const actor of [owner,pgActor]) {
  await pool.query('insert into auth.users(id,email) values ($1,$2)',[actor.uid,actor.token.email]);
  await db.collection('users').doc(actor.uid).set({role:'admin',email:actor.token.email});
}
const before=await pool.query("select count(*)::int as n from public.quality_objections");
if(before.rows[0].n!==0)throw Error('Synthetic empty cluster required');
const now=new Date('2026-11-01T15:00:00+03:00');
const input={op:'source',data:{requestId:'pg-source-one',expectedRevision:0,source:reviewSource()}};
const saved=await compensationReview(db,input,pgActor,now);
const again=await compensationReview(db,input,pgActor,now);
if(!again.replay)throw Error('Idempotency failed');
const r=await compensationReview(db,{op:'read'},owner);
if(r.cases[0].sourceHash!==saved.record.sourceHash)throw Error('PG readback differs');
const changed=reviewSource();changed.facts.complaint='Synthetic concurrent update';
const concurrent=await Promise.allSettled([compensationReview(db,{op:'source',data:{source:changed,requestId:'pg-race-one',expectedRevision:1}},pgActor,now),
  compensationReview(db,{op:'source',data:{source:{...changed,analysis:{...changed.analysis,proven:['Second synthetic change']}},requestId:'pg-race-two',expectedRevision:1}},pgActor,now)]);
if(concurrent.filter(r=>r.status==='fulfilled').length!==1)throw Error('Concurrency invariant failed');
const client=await pool.connect();
try {
  await client.query('begin');await client.query('set local role authenticated');
  await client.query("select set_config('request.jwt.claim.sub',$1,true)",['99999999-1111-4111-8111-111111111111']);
  if((await client.query('select id from public.quality_objections')).rows.length)throw Error('Partner RLS exposed ticket');
  let denied=false;try{await client.query("insert into public.quality_objections(id,period_key) values ('forbidden','2026-11')");}catch(e){denied=e.code==='42501';}
  if(!denied)throw Error('Direct client write allowed');
} finally {await client.query('rollback');client.release();}
await mkdir('../../outputs/compensation-review-20261101',{recursive:true});
await writeFile('../../outputs/compensation-review-20261101/isolated-pg-result.json',JSON.stringify({isolation:'fresh loopback PostgreSQL; synthetic rows only',database:name,port,serverRole:'ledger_server',
  sourceSaveAndRead:true,idempotency:true,concurrentOneWinner:true,unauthorizedReadHidden:true,directClientWriteDenied:true},null,2));
const fixture=await createViteServer({server:{host:'127.0.0.1',port:webPort,strictPort:true},plugins:[{name:'compensation-review-isolated-api',configureServer(server){
  server.middlewares.use(async(req,res,next)=>{
    if(!req.url.startsWith('/__compensation-review'))return next();
    const actor=new URL(req.url,'http://127.0.0.1').searchParams.get('role')==='agent'?pgActor:owner;
    let body='';for await(const chunk of req)body+=chunk;
    try {
      const result=await compensationReview(db,JSON.parse(body),actor,now);
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({result}));
    } catch(e){res.statusCode=400;res.end(JSON.stringify({error:{message:e.message,code:e.code}}));}
  });
}}]});
await fixture.listen();
console.log('ISOLATED_READY http://127.0.0.1:'+webPort+'/scripts/compensation-review-preview/ ; PG loopback '+port+' '+name);
process.on('SIGINT',async()=>{await fixture.close();await db.close();await pool.end();await pg.stop();process.exit(0);});
process.on('SIGTERM',async()=>{await fixture.close();await db.close();await pool.end();await pg.stop();process.exit(0);});



