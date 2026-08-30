import { randomBytes } from 'node:crypto';
import {
  AGENT_COMMAND_MAX_BODY_BYTES,
  AgentCommandCenterError,
  ingestAgentCommandEvent,
  verifyAgentCommandSignature,
} from '../functions/src/agentCommandCenter.js';
import { getAgentCommandCenterDatabase } from '../server/agentCommandCenterDatabase.js';

export const config = {
  api: { bodyParser: false },
  maxDuration: 30,
};

function header(request, name) {
  const value = request.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

async function readRawBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > AGENT_COMMAND_MAX_BODY_BYTES) {
      throw new AgentCommandCenterError('حجم الطلب غير صالح.', { httpStatus: 413 });
    }
    chunks.push(bytes);
  }
  const rawBody = Buffer.concat(chunks);
  if (!rawBody.length) {
    throw new AgentCommandCenterError('حجم الطلب غير صالح.', { httpStatus: 413 });
  }
  return rawBody;
}

export function createAgentCommandCenterHandler({
  databaseFactory = getAgentCommandCenterDatabase,
  ingest = ingestAgentCommandEvent,
} = {}) {
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      response.status(405).json({ ok: false, error: 'method-not-allowed' });
      return;
    }

    try {
      const rawBody = await readRawBody(request);
      const verified = verifyAgentCommandSignature({
        secret: process.env.AGENT_COMMAND_CENTER_WEBHOOK_SECRET,
        signature: header(request, 'X-Sweater-Signature'),
        timestamp: header(request, 'X-Sweater-Timestamp'),
        idempotencyKey: header(request, 'X-Sweater-Idempotency-Key'),
        rawBody,
      });
      let payload;
      try { payload = JSON.parse(rawBody.toString('utf8')); }
      catch { throw new AgentCommandCenterError('جسم الطلب ليس JSON صالحًا.'); }

      const { db, FieldValue } = databaseFactory();
      const result = await ingest(db, FieldValue, payload, verified);
      response.status(200).json({ ok: true, duplicate: result.duplicate, eventId: result.eventId });
    } catch (error) {
      if (error instanceof AgentCommandCenterError) {
        response.status(error.httpStatus || 400).json({ ok: false, error: error.code, message: error.message });
        return;
      }
      const incidentId = randomBytes(6).toString('hex');
      console.error(JSON.stringify({
        severity: 'ERROR', event: 'agent-command-ingest-failure', incidentId,
        errorName: error?.name || 'Error',
      }));
      response.status(500).json({ ok: false, error: 'internal', incidentId });
    }
  };
}

export default createAgentCommandCenterHandler();
