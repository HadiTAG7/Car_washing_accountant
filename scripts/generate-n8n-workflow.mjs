import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const endpoint = 'https://app.hadialghanim.com/api/integrations/sweater/n8n';
const node = (name, type, typeVersion, x, y, parameters) => ({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name,
  type: `n8n-nodes-base.${type}`, typeVersion, position: [x, y], parameters });
const code = (name, x, y, jsCode) => node(name, 'code', 2, x, y, { jsCode });
const http = (name, x, y, jsonBody) => ({ ...node(name, 'httpRequest', 4.2, x, y, {
  method: 'POST', url: endpoint, authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
  sendBody: true, specifyBody: 'json', jsonBody,
  options: { timeout: 60000, redirect: { redirect: { followRedirects: false } }, response: { response: { responseFormat: 'json' } } },
}), retryOnFail: false, onError: 'stopWorkflow' });
const payload = "$('Validate source batch').first().json.payload";
export function makeN8nWorkflow() {
  const nodes = [
    node('SSP batch from another workflow', 'executeWorkflowTrigger', 1.1, 0, 180, { inputSource: 'passthrough' }),
    code('Validate source batch', 240, 180, `const items = $input.all();
if (items.length !== 1) throw new Error('Pass exactly one item containing one payload (at most 100 records).');
const p = items[0].json.payload;
if (!p || p.contractVersion !== 2 || !p.importRunId || !Array.isArray(p.records) || p.records.length > 100 || !p.coverage || p.coverage.recordCount !== p.records.length) throw new Error('A verified operations-v2 source payload is required. No sample/live records are generated here.');
return [{json:{payload:p}}];`),
    http('Check existing batch', 480, 180, `={{ JSON.stringify({action:'status',payload:${payload}}) }}`),
    node('Already saved', 'if', 2.2, 720, 180, { conditions: { options: { caseSensitive: true, typeValidation: 'strict', version: 2 },
      conditions: [{ id: 'found', leftValue: '={{ $json.result.found }}', rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} }),
    http('Preview batch', 960, 340, `={{ JSON.stringify({action:'preview',payload:${payload}}) }}`),
    code('Prepare exact save', 1200, 340, `const r = $input.first().json.result;
if (!r || r.dryRun !== true || r.saved !== false || (r.counts?.rejected || 0) > 0 || !/^[a-f0-9]{64}$/.test(r.reviewedPayloadHash || '') || !/^[a-f0-9]{64}$/.test(r.previewStateHash || '')) throw new Error('Preview refused or contains rejected records; review the source batch.');
return [{json:{action:'save',payload:${payload},reviewedPayloadHash:r.reviewedPayloadHash,previewStateHash:r.previewStateHash}}];`),
    http('Save reviewed batch', 1440, 340, '={{ JSON.stringify($json) }}'),
    http('Verify saved batch', 1680, 340, `={{ JSON.stringify({action:'status',payload:${payload}}) }}`),
    code('Require verified result', 1920, 180, `const r = $input.first().json.result;
if (!r || r.found !== true || r.verified !== true) throw new Error('Persistence could not be verified. Stop and review; do not change the run ID or repeat a save blindly.');
return [{json:{importRunId:${payload}.importRunId,verified:true,coverage:r.coverage,result:r.result}}];`),
    node('Connection instructions', 'stickyNote', 1, 120, -320, { width: 970, height: 400, content:
      '## Sweater — verified batch import\n\n1. Create a dedicated n8n key in the platform integration page.\n2. Create a **Header Auth** credential in n8n: name `Authorization`, value `Bearer <key>`. Select the SAME credential in all four HTTP nodes. Restrict it to `app.hadialghanim.com` when the credential UI supports allowed domains.\n3. Another workflow must supply ONE item `{payload: <operations-v2 batch>}` from a real SSP source. This template does not sign in to SSP or create example bookings.\n4. Keep the full payload + run ID stable across retries. A lost save response is recovered by starting here again: status is checked before preview/save. HTTP nodes do not auto-retry saves or follow redirects. Stop on 401/403/409/412/429; review before rerunning.\n5. Test source access separately. Never import real bookings as a software test. Partial coverage and review-only records remain explicit. No collection, payroll payment or ledger posting.' }),
  ];
  const connections = {};
  const link = (from, to, output = 0) => {
    connections[from] ||= { main: [] };
    connections[from].main[output] = [{ node: to, type: 'main', index: 0 }];
  };
  link('SSP batch from another workflow', 'Validate source batch');
  link('Validate source batch', 'Check existing batch'); link('Check existing batch', 'Already saved');
  link('Already saved', 'Require verified result', 0); link('Already saved', 'Preview batch', 1);
  link('Preview batch', 'Prepare exact save'); link('Prepare exact save', 'Save reviewed batch');
  link('Save reviewed batch', 'Verify saved batch'); link('Verify saved batch', 'Require verified result');
  return { name: 'Sweater | Verified wash import', nodes, connections, active: false,
    settings: { timezone: 'Asia/Riyadh', executionOrder: 'v1' } };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(new URL('../public/integrations/sweater-n8n.json', import.meta.url), JSON.stringify(makeN8nWorkflow(), null, 2) + '\n');
}
