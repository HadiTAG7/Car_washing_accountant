import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function makeVerifiedSourceBatches(source, executionId, validationMode) {
  if (source?.format === 'ssp-columnar-v1') {
    const count=source.coverage?.recordCount;
    if (!Number.isInteger(count) || count<0 || count>2000 || !Array.isArray(source.columns) || source.columns.length>14) throw new Error('Invalid source transport');
    const records=Array.from({length:count},()=>({})), keys=new Set();
    for (const {key,values,indices} of source.columns) {
      if (typeof key!=='string' || ['__proto__','constructor','prototype'].includes(key) || keys.has(key)
        || !Array.isArray(values) || !Array.isArray(indices) || indices.length!==count
        || values.some(v=>v!==null && !['string','number','boolean'].includes(typeof v))) throw new Error('Invalid source transport column');
      keys.add(key);
      indices.forEach((index,i)=>{
        if (!Number.isInteger(index) || index < -1 || index>=values.length) throw new Error('Invalid source transport index');
        if(index!==-1)records[i][key]=values[index];
      });
    }
    source={coverage:source.coverage,records};
  }
  const c=source?.coverage, records=source?.records;
  if (!c || !Array.isArray(records) || c.recordCount !== records.length || c.isComplete !== true
    || c.pagesFetched !== c.pageCount || c.pageCount < 1 || !Array.isArray(c.gaps) || c.gaps.length
    || c.modules?.individual !== 'complete' || c.modules?.corporate !== 'complete'
    || !Number.isFinite(Date.parse(c.extractedAt)) || records.length > 2000) throw new Error('Complete, verified SSP coverage is required before import');
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(String(executionId))) throw new Error('Invalid execution ID');
  const allowed=new Set(['sspBookingId','bookingKind','serviceDate','serviceType','serviceTypeLabel','driverExternalId','rawStatus','serviceTime','arrivedAt','startedAt','completedAt','platformAmount','sourceUrl','notes']);
  const seen=new Set();
  for (const r of records) {
    const prefix='https://ssp-portal.sweater.sa'+(r.bookingKind==='individual'?'/bookings':'/b2b-bookings')+'?';
    if (typeof r.sourceUrl!=='string' || !r.sourceUrl.startsWith(prefix) || /[#@]/.test(r.sourceUrl)) throw new Error('Invalid source URL');
    const entries=r.sourceUrl.slice(prefix.length).split('&').map(part=>part.split('=').map(decodeURIComponent));
    const query=Object.fromEntries(entries);
    if (Object.keys(r).some(k=>!allowed.has(k)) || !/^[A-Z]-\d+$/.test(r.sspBookingId) || seen.has(r.sspBookingId)
      || !['individual','corporate'].includes(r.bookingKind) || !r.rawStatus || !r.serviceType
      || r.serviceDate < c.rangeFrom || r.serviceDate > c.rangeTo || entries.length!==Object.keys(query).length
      || query.fromDate !== r.serviceDate || query.toDate !== r.serviceDate
      || Object.keys(query).some(k=>!['page','pageSize','fromDate','toDate'].includes(k))) throw new Error('Invalid or repeated source record');
    seen.add(r.sspBookingId);
  }
  const result=[];
  for (let i=0;i<Math.max(1,records.length);i+=100) {
    const batch=records.slice(i,i+100);
    result.push({json:{validationMode, payload:{contractVersion:2,importRunId:`n8n-${executionId}-b${i/100+1}`,agentStatus:'ok',
      coverage:{...c,recordCount:batch.length},workerLinks:{},records:batch}}});
  }
  return result;
}

export function browserbaseCollectorScript() {
  const core=readFileSync(new URL('./ssp-cloud-collector.mjs',import.meta.url),'utf8').replaceAll('export function ','function ').replaceAll('export async function ','async function ');
  return `const remote = await chromium.connectOverCDP(connectUrl);
try {
  const context=remote.contexts()[0], page=context.pages()[0];
  const cdp=await context.newCDPSession(page);
  await cdp.send('Emulation.setTimezoneOverride',{timezoneId:'Asia/Riyadh'});
  return packSspSource(await collectSspWashes(page,{rangeFrom:params.rangeFrom,rangeTo:params.rangeTo}));
} finally { await remote.close(); }
${core}`;
}

export function makeN8nCloudSync({functionId='SET_BROWSERBASE_FUNCTION_ID',contextId='SET_SSP_CONTEXT_ID',importWorkflowId='SET_IMPORT_WORKFLOW_ID',
  sourceCredentialId,sourceCredentialName='Browserbase account',importCredentialId,importCredentialName='Sweater | Wash import',validationMode=true,days=7}={}) {
  if (![1,7].includes(days)) throw new Error('Use one completed day for initial validation or seven for daily sync');
  const node=(name,type,version,x,y,parameters)=>({id:name.toLowerCase().replace(/[^a-z0-9]+/g,'-'),name,type:`n8n-nodes-base.${type}`,typeVersion:version,position:[x,y],parameters});
  const code=(name,x,y,jsCode)=>node(name,'code',2,x,y,{jsCode});
  const http=(name,x,y,parameters,credential)=>({...node(name,'httpRequest',4.2,x,y,{...parameters,options:{timeout:60000,redirect:{redirect:{followRedirects:false}},response:{response:{responseFormat:'json'}}}}),...(credential?{credentials:credential}:{}),retryOnFail:false,onError:'stopWorkflow'});
  // Public exports must not look connected merely because an account name exists.
  // Bind credentials only when configuring a specific n8n instance with stored IDs.
  const sourceAuth=sourceCredentialId?{browserbaseApi:{id:sourceCredentialId,name:sourceCredentialName}}:undefined;
  const appAuth=importCredentialId?{httpHeaderAuth:{id:importCredentialId,name:importCredentialName}}:undefined;
  const nodes=[
    node('Manual sync','manualTrigger',1,0,0,{}),
    node('Midnight Riyadh','scheduleTrigger',1.2,0,220,{rule:{interval:[{field:'cronExpression',expression:'0 0 * * *'}]}}),
    code('Prepare source job',240,100,`const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
const day=Object.fromEntries(parts.map(p=>[p.type,p.value]));const today=Date.parse(day.year+'-'+day.month+'-'+day.day+'T00:00:00Z');
const rangeFrom=new Date(today-${days}*86400000).toISOString().slice(0,10),rangeTo=new Date(today-86400000).toISOString().slice(0,10);
const request={params:{rangeFrom,rangeTo},sessionCreateParams:{browserSettings:{context:{id:${JSON.stringify(contextId)},persist:true},recordSession:false,logSession:false},timeout:900}};
return [{json:{rangeFrom,rangeTo,validationMode:${JSON.stringify(validationMode)},request}}];`),
    http('Invoke SSP collector',480,100,{method:'POST',url:`https://api.browserbase.com/v1/functions/${functionId}/invoke`,authentication:'predefinedCredentialType',nodeCredentialType:'browserbaseApi',sendBody:true,specifyBody:'json',jsonBody:'={{ JSON.stringify($json.request) }}'},sourceAuth),
    node('Wait for source','wait',1.1,720,100,{resume:'timeInterval',amount:15,unit:'seconds'}),
    http('Read collector result',960,100,{url:"={{ 'https://api.browserbase.com/v1/functions/invocations/' + $('Invoke SSP collector').first().json.id }}",authentication:'predefinedCredentialType',nodeCredentialType:'browserbaseApi'},sourceAuth),
    code('Check collector state',1200,100,`const r=$input.first().json;
if (!['PENDING','RUNNING','COMPLETED'].includes(r.status)) throw new Error('SSP collector failed; check its invocation. No batch was saved.');
if ($runIndex>=64 && r.status!=='COMPLETED') throw new Error('SSP collector polling limit reached. Review the existing invocation before rerunning.');
return [{json:r}];`),
    node('Source ready','if',2.2,1440,100,{conditions:{options:{caseSensitive:true,typeValidation:'strict',version:2},conditions:[{id:'complete',leftValue:'={{ $json.status }}',rightValue:'COMPLETED',operator:{type:'string',operation:'equals'}}],combinator:'and'},options:{}}),
    code('Prepare verified batches',1680,0,`${makeVerifiedSourceBatches.toString()}
const r=$input.first().json;
return makeVerifiedSourceBatches(r.results,$execution.id,$('Prepare source job').first().json.validationMode);`),
    node('Validation only','if',2.2,1920,0,{conditions:{options:{caseSensitive:true,typeValidation:'strict',version:2},conditions:[{id:'dry-run',leftValue:'={{ $json.validationMode }}',rightValue:true,operator:{type:'boolean',operation:'true',singleValue:true}}],combinator:'and'},options:{}}),
    http('Preview source batches',2160,-180,{method:'POST',url:'https://app.hadialghanim.com/api/integrations/sweater/n8n',authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',sendBody:true,specifyBody:'json',jsonBody:"={{ JSON.stringify({action:'preview',payload:$json.payload}) }}"},appAuth),
    code('Verify previews',2400,-180,`const results=$input.all().map(i=>i.json.result);
if(results.length!==$('Prepare verified batches').all().length || results.some(r=>!r || r.dryRun!==true || r.saved!==false || r.counts?.rejected>0)) throw new Error('Source preview failed. Nothing was saved.');
return [{json:{validationOnly:true,saved:false,batches:results.length,records:$('Prepare verified batches').all().reduce((n,i)=>n+i.json.payload.records.length,0),previews:results}}];`),
    node('Import and verify each batch','executeWorkflow',1.3,2160,100,{source:'database',workflowId:{__rl:true,value:importWorkflowId,mode:'id'},mode:'each',options:{waitForSubWorkflow:true}}),
    code('Require all batches verified',2400,100,`const results=$input.all().map(i=>i.json);
if(results.length!==$('Prepare verified batches').all().length || results.some(r=>r.verified!==true)) throw new Error('Not every saved batch was verified. Review existing run IDs before rerunning.');
const counts={new:0,modified:0,duplicate:0,rejected:0,needsReview:0};let washesCreated=0;
for(const r of results){for(const k of Object.keys(counts))counts[k]+=r.result?.counts?.[k]||0;washesCreated+=r.result?.washesCreated||0;}
return [{json:{verified:true,batches:results.length,records:$('Prepare verified batches').all().reduce((n,i)=>n+i.json.payload.records.length,0),washesCreated,counts,ledgerPosted:false,payrollPaid:false,runIds:results.map(r=>r.importRunId)}}];`),
    node('Cloud sync operating notes','stickyNote',1,240,-450,{width:1100,height:300,content:'## Sweater cloud source → verified import\n\n00:00 Asia/Riyadh; previous seven completed service days. Browserbase reads every individual and B2B page plus booking event details. Customer data is excluded. The platform reuses only established stable biker links. Missing or conflicting links remain reviewable.\n\nValidation mode calls preview only. Production mode runs the existing atomic import workflow separately for each batch of at most 100 records, then requires verification for every batch. No collection, payroll payment or ledger posting.\n\nA logged-out source, changed page contract, failed function or incomplete coverage stops before import. Refresh SSP login manually in the saved Browserbase Context when needed. Never start concurrent source runs with the same Context.'}),
  ];
  const connections={};const link=(from,to,out=0)=>{connections[from]??={main:[]};connections[from].main[out]=[{node:to,type:'main',index:0}];};
  for(const from of ['Manual sync','Midnight Riyadh'])link(from,'Prepare source job');
  for(const [a,b] of [['Prepare source job','Invoke SSP collector'],['Invoke SSP collector','Wait for source'],['Wait for source','Read collector result'],['Read collector result','Check collector state'],['Check collector state','Source ready'],['Source ready','Prepare verified batches'],['Prepare verified batches','Validation only'],['Validation only','Preview source batches'],['Preview source batches','Verify previews'],['Import and verify each batch','Require all batches verified']])link(a,b);
  link('Source ready','Wait for source',1);link('Validation only','Import and verify each batch',1);
  return {name:'Sweater | Daily wash sync',nodes,connections,active:false,settings:{timezone:'Asia/Riyadh',executionOrder:'v1',executionTimeout:1200}};
}

if (process.argv[1]===fileURLToPath(import.meta.url)) {
  writeFileSync(new URL('../public/integrations/sweater-n8n-cloud.json',import.meta.url),JSON.stringify(makeN8nCloudSync(),null,2)+'\n');
  writeFileSync(new URL('../public/integrations/sweater-browserbase-function.js',import.meta.url),browserbaseCollectorScript());
}
