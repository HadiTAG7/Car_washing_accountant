// firebase/app on Supabase: apps are names only (the secondary one gives an
// isolated auth client for creating another account without signing out).
const apps = new Map();
export function initializeApp(options = {}, name = '[DEFAULT]') {
  const app = { name, options, automaticDataCollectionEnabled: false };
  apps.set(name, app);
  return app;
}
export const getApps = () => [...apps.values()];
export const getApp = (name = '[DEFAULT]') => apps.get(name) || initializeApp({}, name);
export async function deleteApp(app) { apps.delete(app?.name); }
