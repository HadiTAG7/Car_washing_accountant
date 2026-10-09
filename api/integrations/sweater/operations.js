import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { operationsHandler } from '../../../functions/src/sweater/operationsHttp.js';

function getDb() {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('Missing server configuration');
    initializeApp({ credential: cert(JSON.parse(raw)) });
  }
  return getFirestore();
}
export default operationsHandler({ getDb, FieldValue });
