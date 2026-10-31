// Explicit production tool. The old sweater_dryrun.mjs is neither imported nor
// changed. Credential access occurs only inside the separately approved signer.
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { approvedSignerPath } from './lib/windows-operations-signing.mjs';
import { hashBody } from '../functions/src/sweater/record.js';
import { validateOperationsPayload } from '../functions/src/sweater/operationsSync.js';
import { validateMetricsSnapshot } from '../functions/src/sweater/metricsContract.js';
import { makeOperationsTransport, syncOperations, syncMetricsSnapshot, syncPlan, coverageGaps } from './lib/sweater-operations-client.mjs';

const args = process.argv.slice(2);
const previewOnly = args.includes('--preview-only');
// --metrics: one month's reading of Sweater's dashboards (metricsContract.js), not a bookings batch.
const metricsOnly = args.includes('--metrics');
// --plan: before reading SSP, what this run must read — the last 3 days and every booking still open (read-only, signed).
const planOnly = args.includes('--plan');
const input = args.find(a => !a.startsWith('--'));
if ((!input && !planOnly) || (planOnly && (input || previewOnly || metricsOnly))
  || args.some(a => a.startsWith('--') && !['--preview-only', '--metrics', '--plan'].includes(a)) || (previewOnly && metricsOnly)) {
  throw new Error('Usage: node scripts/sync-sweater-operations.mjs --plan | payload.json [--preview-only | --metrics]');
}
// The signer must be an independently approved credential-store adapter, with
// sign({timestamp, importRunId, bodyHash}) -> {keyId, signature}. No secret is
// returned to this tool or stored in the input/manifest/receipt.
const signerPath = process.env.SWEATER_OPERATIONS_SIGNER_MODULE;
const approvedPath = await approvedSignerPath(signerPath);
const payload = planOnly ? null : JSON.parse(await readFile(input, 'utf8'));
if (!planOnly) (metricsOnly ? validateMetricsSnapshot : validateOperationsPayload)(payload);
let adapter;
try { adapter = await import(pathToFileURL(approvedPath).href); }
catch { throw new Error('Cannot load the approved signing adapter. Credential-store diagnostics are not logged.'); }
const { sign } = adapter;
if (typeof sign !== 'function') throw new Error('The approved signing adapter must export sign().');
if (planOnly) {
  try { console.log(JSON.stringify(await syncPlan({ request: makeOperationsTransport({ sign }) }), null, 2)); }
  catch { console.error('Could not read the open bookings. No credential details are logged.'); process.exitCode = 1; }
} else if (metricsOnly) {
  try {
    // Idempotent by run id and body: re-running the same file reads back the same row.
    console.log(JSON.stringify(await syncMetricsSnapshot(payload, { request: makeOperationsTransport({ sign }) })));
  } catch { console.error('Metrics reading did not verify. Keep the same file/run; no credential details are logged.'); process.exitCode = 1; }
} else {
  const manifestPath = `${input}.sync-manifest.json`;
  let manifest = null;
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw new Error('Cannot read persisted manifest.'); }
  if (manifest && (manifest.importRunId !== payload.importRunId || manifest.payloadHash !== hashBody(payload))) throw new Error('Payload changed after preparation; keep its original run/body and investigate.');
  const persist = async next => {
    if (!manifest) { await writeFile(manifestPath, JSON.stringify(next, null, 2), { flag: 'wx', mode: 0o600 }); manifest = next; return; }
    if (next.saveRequest && !manifest.saveRequest) {
      // A separate exclusive immutable save file avoids corrupting/overwriting
      // the already prepared manifest if the process stops between writes.
      await writeFile(`${manifestPath}.save.json`, JSON.stringify(next, null, 2), { flag: 'wx', mode: 0o600 }); manifest = next;
    }
  };
  let savedRequest = manifest?.saveRequest ?? null;
  try {
    const saved = JSON.parse(await readFile(`${manifestPath}.save.json`, 'utf8'));
    if (saved.payloadHash !== hashBody(payload) || saved.importRunId !== payload.importRunId) throw new Error('Persisted save does not match payload.');
    savedRequest = saved.saveRequest;
  } catch (e) { if (e.code !== 'ENOENT') throw new Error('Cannot verify persisted save request.'); }
  const request = makeOperationsTransport({ sign });
  // Every run reads the last 3 days and re-reads every booking still open in Sweater. Say so before saving a run that does not.
  try { for (const gap of coverageGaps(payload, await syncPlan({ request }))) console.error(`SWEATER SYNC GAP: ${gap}`); }
  catch { console.error('SWEATER SYNC GAP: could not read the open bookings; run --plan before the next run.'); }
  try {
    const result = await syncOperations(payload, { request, persist, savedRequest, previewOnly });
    console.log(JSON.stringify(result)); // Only sanitized server result, never signer/headers.
    if (!previewOnly) {
      // What the next run must read: the window and each open booking by number (into `rechecks`).
      try { console.log(`NEXT RUN: ${JSON.stringify(await syncPlan({ request }))}`); } catch { /* the next --plan will say it */ }
    }
  } catch { console.error('Operational sync did not verify. Keep the same payload/run and manifest; inspect the status before retry. No credential details are logged.'); process.exitCode = 1; }
}
