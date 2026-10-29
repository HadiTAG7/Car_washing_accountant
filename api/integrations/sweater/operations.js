import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { operationsHandler } from '../../../functions/src/sweater/operationsHttp.js';
import { n8nOperationsHandler } from '../../../functions/src/sweater/n8nHttp.js';
import { onSupabase, supabaseRuntime } from '../../../server/db/backend.js';

function getDb() {
  // firebase-admin's FieldValue sentinels are understood by pgstore as well.
  if (onSupabase()) return supabaseRuntime().db;
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('Missing server configuration');
    initializeApp({ credential: cert(JSON.parse(raw)) });
  }
  return getFirestore();
}
const signed = operationsHandler({ getDb, FieldValue });
const n8n = n8nOperationsHandler({ getDb, FieldValue });
// Both protocols share a deployed function to remain within the hosting plan's
// function limit. The rewrite selects a distinct authenticator, never a fallback.
export default function handler(req, res) {
  return (req.query?.n8nEndpoint === '1' ? n8n : signed)(req, res);
}
