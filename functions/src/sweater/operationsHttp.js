import { verifyIngestRequest, IntegrationAuthError, INTEGRATION_PRINCIPAL } from './integrationKeys.js';
import { SweaterIngestError, MAX_BODY_BYTES } from './ingest.js';
import { hashBody } from './record.js';
import { validateOperationsPayload, previewOperations, saveOperations, operationsStatus } from './operationsSync.js';

// Complete action + payload + preview hashes are signed. An import signature
// cannot be reused as a status/save signature or to alter extraction coverage.
export const operationsSigningHash = body => hashBody({ protocol: 'sweater-operations-v2', request: body });
const STATUS = { unauthenticated: 401, 'permission-denied': 403, 'invalid-argument': 400,
  'already-exists': 409, 'failed-precondition': 412, 'resource-exhausted': 429 };
const header = (req, key) => req.headers?.[key] ?? '';

export function operationsHandler({ getDb, FieldValue, verify = verifyIngestRequest }) {
  return async (req, res) => {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: { code: 'invalid-argument', message: 'POST only.' } }); }
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!body || Array.isArray(body) || Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES) {
        return res.status(413).json({ error: { code: 'invalid-argument', message: 'Request exceeds the operational contract.' } });
      }
      const allowed = body.action === 'save' ? ['action', 'payload', 'reviewedPayloadHash', 'previewStateHash'] : ['action', 'payload'];
      if (!['preview', 'save', 'status'].includes(body.action) || Object.keys(body).some(k => !allowed.includes(k))) {
        throw new SweaterIngestError('Only preview, save or status requests are allowed.');
      }
      validateOperationsPayload(body.payload);
      const db = getDb();
      const auth = await verify(db, FieldValue, { keyId: header(req, 'x-sweater-key-id'), timestamp: header(req, 'x-sweater-timestamp'),
        signature: header(req, 'x-sweater-signature'), importRunId: body.payload.importRunId,
        bodyHash: operationsSigningHash(body), requiredPrincipal: INTEGRATION_PRINCIPAL });
      const result = body.action === 'preview' ? await previewOperations(db, body.payload)
        : body.action === 'status' ? await operationsStatus(db, body.payload)
          : await saveOperations(db, FieldValue, { payload: body.payload, reviewedPayloadHash: body.reviewedPayloadHash, previewStateHash: body.previewStateHash }, auth.principal);
      return res.status(200).json({ result });
    } catch (error) {
      const known = error instanceof SweaterIngestError || error instanceof IntegrationAuthError;
      const code = known ? error.code : error instanceof SyntaxError ? 'invalid-argument' : 'internal';
      const status = STATUS[code] ?? 500;
      // Never print request/credentials or internal encryption errors to callers/logs.
      if (status === 500) console.error('sweater/operations failed', { name: error.name });
      return res.status(status).json({ error: { code, message: known ? error.message : status === 400 ? 'Invalid JSON.' : 'Operational service unavailable.' } });
    }
  };
}
