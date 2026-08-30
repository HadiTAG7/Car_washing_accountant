import { randomBytes, timingSafeEqual } from 'node:crypto';
import { deleteExpiredIngestionMarkers } from '../server/agentCommandCenterCleanup.js';
import { getAgentCommandCenterDatabase } from '../server/agentCommandCenterDatabase.js';

export const config = { maxDuration: 30 };

function header(request, name) {
  const value = request.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function validCronAuthorization(provided, secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('cron-secret-missing-or-weak');
  }
  const actual = Buffer.from(String(provided || ''), 'utf8');
  const expected = Buffer.from(`Bearer ${secret}`, 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createAgentCommandCenterCleanupHandler({
  databaseFactory = getAgentCommandCenterDatabase,
  cleanup = deleteExpiredIngestionMarkers,
  now = () => new Date(),
} = {}) {
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      response.status(405).json({ ok: false, error: 'method-not-allowed' });
      return;
    }

    try {
      if (!validCronAuthorization(header(request, 'Authorization'), process.env.CRON_SECRET)) {
        response.status(401).json({ ok: false, error: 'unauthorized' });
        return;
      }

      const { db } = databaseFactory();
      const result = await cleanup(db, now());
      console.info(JSON.stringify({
        severity: 'INFO', event: 'agent-command-cleanup-complete', ...result,
      }));
      response.status(200).json({ ok: true, ...result });
    } catch (error) {
      const incidentId = randomBytes(6).toString('hex');
      console.error(JSON.stringify({
        severity: 'ERROR', event: 'agent-command-cleanup-failure', incidentId,
        errorName: error?.name || 'Error',
      }));
      response.status(500).json({ ok: false, error: 'internal', incidentId });
    }
  };
}

export default createAgentCommandCenterCleanupHandler();
