import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { n8nOperationsHandler } from '../../../functions/src/sweater/n8nHttp.js';
import { onSupabase, supabaseRuntime } from '../../../server/db/backend.js';

function getDb() {
  if (onSupabase()) return supabaseRuntime().db;
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('Missing server configuration');
    initializeApp({ credential: cert(JSON.parse(raw)) });
  }
  return getFirestore();
}
export default n8nOperationsHandler({ getDb, FieldValue });
