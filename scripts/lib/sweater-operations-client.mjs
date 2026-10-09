import { operationsSigningHash } from '../../functions/src/sweater/operationsHttp.js';
import { hashBody } from '../../functions/src/sweater/record.js';
import { validateOperationsPayload } from '../../functions/src/sweater/operationsSync.js';

export const OPERATIONS_ENDPOINT = 'https://sweater-hadi-alghanim.vercel.app/api/integrations/sweater/operations';
export class OperationsClientError extends Error {
  constructor(message, status = null) { super(message); this.status = status; }
}

export function makeOperationsTransport({ sign, fetchImpl = fetch, timeoutMs = 25000 }) {
  return async request => {
    const allowed = request?.action === 'save' ? ['action', 'payload', 'reviewedPayloadHash', 'previewStateHash'] : ['action', 'payload'];
    if (!request || !['preview', 'save', 'status'].includes(request.action) || Object.keys(request).some(k => !allowed.includes(k))
      || (request.action === 'save' && (!/^[a-f0-9]{64}$/.test(request.reviewedPayloadHash ?? '') || !/^[a-f0-9]{64}$/.test(request.previewStateHash ?? '')))) {
      throw new OperationsClientError('Operational request refused before signing.');
    }
    try { validateOperationsPayload(request.payload); } catch { throw new OperationsClientError('Operational request refused before signing.'); }
    const timestamp = String(Math.floor(Date.now() / 1000));
    let auth;
    try { auth = await sign({ timestamp, importRunId: request.payload.importRunId, bodyHash: operationsSigningHash(request) }); }
    catch { throw new OperationsClientError('Signing unavailable; credential diagnostics are not disclosed.', 401); }
    if (!auth || Object.keys(auth).length !== 2 || typeof auth.keyId !== 'string' || !/^[a-f0-9]{64}$/.test(auth.signature ?? '')) throw new OperationsClientError('Approved signer returned invalid authentication.', 401);
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(OPERATIONS_ENDPOINT, { method: 'POST', signal: controller.signal,
        redirect: 'error', headers: { 'content-type': 'application/json', 'x-sweater-key-id': auth.keyId,
          'x-sweater-timestamp': timestamp, 'x-sweater-signature': auth.signature }, body: JSON.stringify(request) });
      const result = await response.json();
      if (!response.ok) throw new OperationsClientError(`Operational request refused (HTTP ${response.status}).`, response.status);
      if (!result.result) throw new OperationsClientError('Operational response cannot be verified.');
      return result.result;
    } catch (error) {
      if (error instanceof OperationsClientError) throw error;
      // Do not return fetch/signer internals that may contain authentication.
      throw new OperationsClientError('Connection interrupted; readback is required.');
    } finally { clearTimeout(timer); }
  };
}

// Retries are for transport/429/5xx only. Logical rejection never retries.
const transient = e => e instanceof OperationsClientError && (e.status == null || e.status === 429 || e.status >= 500);
export async function syncOperations(payload, { request, persist, savedRequest = null, previewOnly = false,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  validateOperationsPayload(payload);
  const payloadHash = hashBody(payload);
  const read = async body => {
    for (let n = 0; n < 3; n++) {
      try { return await request(body); }
      catch (e) { if (!transient(e) || n === 2) throw e; await sleep(e.status === 429 ? 60000 : 1000 * 2 ** n); }
    }
  };
  if (previewOnly) return read({ action: 'preview', payload });
  // Durable complete payload fingerprint BEFORE any save, never secrets.
  await persist({ importRunId: payload.importRunId, payloadHash });
  const check = () => read({ action: 'status', payload });
  const verified = status => {
    if (!status.verified || status.payloadHash !== payloadHash || status.result?.importRunId !== payload.importRunId
      || status.verification?.length !== payload.records.length) throw new OperationsClientError('Batch is stored but readback is incomplete; stop without writing again.');
    return status;
  };
  const before = await check();
  if (before.found) return verified(before);
  let saveRequest = savedRequest;
  if (saveRequest && (saveRequest.action !== 'save' || hashBody(saveRequest.payload) !== payloadHash)) throw new OperationsClientError('Persisted request does not match the immutable payload.');
  if (!saveRequest) {
    const preview = await read({ action: 'preview', payload });
    if (preview.reviewedPayloadHash !== payloadHash) throw new OperationsClientError('Preview does not match the complete payload.');
    saveRequest = { action: 'save', payload, reviewedPayloadHash: preview.reviewedPayloadHash, previewStateHash: preview.previewStateHash };
    await persist({ importRunId: payload.importRunId, payloadHash, saveRequest });
  }
  for (let n = 0; n < 3; n++) {
    try {
      await request(saveRequest);
      // Success HTTP is not success until historical raw and all rows read back.
      return verified(await check());
    } catch (e) {
      if (!transient(e)) throw e;
      // Never blind-retry a timeout: read the same full-payload run first.
      const status = await check();
      if (status.found) return verified(status);
      if (n === 2) throw new OperationsClientError('Three save attempts exhausted; retain the same run/body for investigation.');
      await sleep(e.status === 429 ? 60000 : 1000 * 2 ** n);
    }
  }
}
