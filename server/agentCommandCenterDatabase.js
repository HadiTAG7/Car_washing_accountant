import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const APP_NAME = 'agent-command-center-vercel';
const DEFAULT_PROJECT_ID = 'gemini-eed4a';

function loadServiceAccount() {
  const raw = process.env.AGENT_COMMAND_CENTER_FIREBASE_SERVICE_ACCOUNT
    || process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('agent-command-center-service-account-missing');
  let serviceAccount;
  try { serviceAccount = JSON.parse(raw); }
  catch { throw new Error('agent-command-center-service-account-invalid'); }

  const projectId = process.env.AGENT_COMMAND_CENTER_FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  if (serviceAccount.project_id !== projectId) {
    throw new Error('agent-command-center-project-mismatch');
  }
  return { projectId, serviceAccount };
}

export function getAgentCommandCenterDatabase() {
  let app = getApps().find((candidate) => candidate.name === APP_NAME);
  if (!app) {
    const { projectId, serviceAccount } = loadServiceAccount();
    app = initializeApp({ credential: cert(serviceAccount), projectId }, APP_NAME);
  }
  return { db: getFirestore(app), FieldValue };
}
