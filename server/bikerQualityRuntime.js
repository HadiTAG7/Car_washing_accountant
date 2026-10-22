import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { onSupabase, supabaseRuntime } from './db/backend.js';

export function getBikerQualityRuntime() {
  if (onSupabase()) return supabaseRuntime();
  const emulators = Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST);
  if (emulators && !String(process.env.GCLOUD_PROJECT || '').startsWith('demo-')) throw new Error('Demo project required.');
  if (Boolean(process.env.FIRESTORE_EMULATOR_HOST) !== Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST)) throw new Error('Both emulators required.');
  let app = getApps().find(candidate => candidate.name === 'biker-quality-vercel');
  if (!app) {
    const options = emulators ? { projectId: process.env.GCLOUD_PROJECT }
      : { credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || 'null')) };
    app = initializeApp(options, 'biker-quality-vercel');
  }
  return { auth: getAuth(app), db: getFirestore(app) };
}
