import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ESLint } from 'eslint';
import { makeVerifiedSourceBatches, makeN8nCloudSync, browserbaseCollectorScript } from '../../scripts/generate-n8n-cloud-sync.mjs';
import { packSspSource } from '../../scripts/ssp-cloud-collector.mjs';
const source = (count=1) => ({ coverage:{rangeFrom:'2026-10-28',rangeTo:'2026-10-28',extractedAt:'2026-10-29T00:00:00+03:00',pageCount:12,pagesFetched:12,recordCount:count,isComplete:true,modules:{individual:'complete',corporate:'complete'},gaps:[],sourceUrl:'https://ssp-portal.sweater.sa/bookings'},
  records:Array.from({length:count},(_,i)=>({sspBookingId:`S-${990000+i}`,bookingKind:'individual',serviceDate:'2026-10-28',serviceType:'interior_exterior_wash',rawStatus:'Collecting Payment',driverExternalId:'2001',sourceUrl:'https://ssp-portal.sweater.sa/bookings?page=1&fromDate=2026-10-28&toDate=2026-10-28'})) });
describe('verified cloud batch boundary', () => {
  it('lints Playground bodies without ignoring undefined names or invalid syntax', async () => {
    const lint = new ESLint();
    const filePath = 'public/integrations/sweater-browserbase-function.js';
    const valid = await lint.lintText('return await chromium.connectOverCDP(connectUrl);', { filePath });
    expect(valid[0].errorCount).toBe(0);
    const unknown = await lint.lintText('return missingGeneratedFunction(params);', { filePath });
    expect(unknown[0].messages).toEqual(expect.arrayContaining([expect.objectContaining({ ruleId: 'no-undef', line: 1 })]));
    const invalid = await lint.lintText('return (', { filePath });
    expect(invalid[0].fatalErrorCount).toBeGreaterThan(0);
  });
  it('ships the generated collector as a valid async Function body', () => {
    const source = browserbaseCollectorScript();
    const artifact = readFileSync(new URL('../../public/integrations/sweater-browserbase-function.js', import.meta.url), 'utf8');
    expect(artifact.replaceAll('\r\n', '\n')).toBe(source.replaceAll('\r\n', '\n'));
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    expect(() => new AsyncFunction('chromium', 'connectUrl', 'params', source)).not.toThrow();
  });
  it('exports an inactive public template without credential bindings', () => {
    const workflow = makeN8nCloudSync();
    expect(workflow.active).toBe(false);
    expect(workflow.nodes.every(node => node.credentials === undefined)).toBe(true);
  });
  it('binds only explicitly supplied stored credential IDs, not display names alone', () => {
    const unbound = makeN8nCloudSync({ sourceCredentialName: 'Source display name', importCredentialName: 'Import display name' });
    expect(unbound.nodes.every(node => node.credentials === undefined)).toBe(true);
    const configured = makeN8nCloudSync({ sourceCredentialId: 'source-fixture-id', importCredentialId: 'import-fixture-id' });
    expect(configured.nodes.find(node => node.name === 'Invoke SSP collector').credentials)
      .toEqual({ browserbaseApi: { id: 'source-fixture-id', name: 'Browserbase account' } });
    expect(configured.nodes.find(node => node.name === 'Read collector result').credentials)
      .toEqual({ browserbaseApi: { id: 'source-fixture-id', name: 'Browserbase account' } });
    expect(configured.nodes.find(node => node.name === 'Preview source batches').credentials)
      .toEqual({ httpHeaderAuth: { id: 'import-fixture-id', name: 'Sweater | Wash import' } });
    expect(configured.active).toBe(false);
  });
  it('round-trips a full week below the cloud result limit without losing optional or null facts', () => {
    const data=source(350);
    data.records.forEach((r,i)=>Object.assign(r,{arrivedAt:`2026-10-28T${String(i%24).padStart(2,'0')}:00:00+03:00`,startedAt:`2026-10-28T${String(i%24).padStart(2,'0')}:01:00+03:00`,completedAt:i%10?`2026-10-28T${String(i%24).padStart(2,'0')}:15:00+03:00`:null,platformAmount:20,notes:'Displayed event times have minute precision; browser timezone fixed to Asia/Riyadh. Classification follows the owner rule.'}));
    const packed=packSspSource(data);
    expect(Buffer.byteLength(JSON.stringify(data))).toBeGreaterThan(65536);
    expect(Buffer.byteLength(JSON.stringify(packed))).toBeLessThan(64000);
    expect(makeVerifiedSourceBatches(packed,'week',false)).toEqual(makeVerifiedSourceBatches(data,'week',false));
    const sandbox=new Function('URL','source',`return (${makeVerifiedSourceBatches.toString()})(source,'week',false);`);
    expect(sandbox(undefined,packed)).toEqual(makeVerifiedSourceBatches(data,'week',false));
    packed.columns[0].indices[0]=99999;
    expect(()=>makeVerifiedSourceBatches(packed,'week',false)).toThrow('Invalid source transport index');
  });
  it('splits a full source result into stable bounded run IDs without exporting worker data', () => {
    const data=source(205), batches=makeVerifiedSourceBatches(data,'execution-1',false);
    expect(batches.map(i=>i.json.payload.records.length)).toEqual([100,100,5]);
    expect(batches.map(i=>i.json.payload.importRunId)).toEqual(['n8n-execution-1-b1','n8n-execution-1-b2','n8n-execution-1-b3']);
    expect(batches.every(i=>Object.keys(i.json.payload.workerLinks).length===0)).toBe(true);
    expect(makeVerifiedSourceBatches(data,'execution-1',false)).toEqual(batches);
    // n8n's Code sandbox does not provide the Node URL constructor.
    const sandbox=new Function('URL','source',`return (${makeVerifiedSourceBatches.toString()})(source,'execution-1',false);`);
    expect(sandbox(undefined,data)).toEqual(batches);
  });
  it.each(['partial','missing-page','duplicate','private-field','foreign-url'])('refuses %s before a preview or save can run', failure => {
    const data=source(2);
    if(failure==='partial')data.coverage.isComplete=false;
    if(failure==='missing-page')data.coverage.pagesFetched--;
    if(failure==='duplicate')data.records[1]=data.records[0];
    if(failure==='private-field')data.records[0].customerPhone='not-forwarded';
    if(failure==='foreign-url')data.records[0].sourceUrl='https://example.com/bookings';
    expect(()=>makeVerifiedSourceBatches(data,'execution-1',false)).toThrow();
  });
  it('keeps the dry-run branch distinct from the real per-batch import and verifies all results', () => {
    const w=makeN8nCloudSync({validationMode:true,days:1});
    expect(w.settings.timezone).toBe('Asia/Riyadh');
    expect(w.active).toBe(false);
    const workflow=w.nodes.find(n=>n.name==='Import and verify each batch');
    expect(workflow.parameters).toMatchObject({mode:'each',options:{waitForSubWorkflow:true}});
    expect(w.connections['Validation only'].main[0][0].node).toBe('Preview source batches');
    expect(w.connections['Validation only'].main[1][0].node).toBe('Import and verify each batch');
    const code=w.nodes.find(n=>n.name==='Require all batches verified').parameters.jsCode;
    const input={all:()=>[{json:{verified:true,result:{counts:{new:1},washesCreated:1}}}]};
    const references=()=>({all:()=>[{json:{payload:{records:[{}]}}},{json:{payload:{records:[{}]}}}]});
    expect(()=>new Function('$input','$',code)(input,references)).toThrow('Not every saved batch was verified');
  });
});
