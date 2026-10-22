// Test-only stand-in for `firebase-admin/app` (see firestore.js beside it).
const apps = new Map();
export function initializeApp(options = {}, name = '[DEFAULT]') { const app = { name, options }; apps.set(name, app); return app; }
export function getApps() { return [...apps.values()]; }
export function getApp(name = '[DEFAULT]') { return apps.get(name); }
export async function deleteApp(app) { apps.delete(app?.name); }
export const cert = x => x;
export const applicationDefault = () => ({});
