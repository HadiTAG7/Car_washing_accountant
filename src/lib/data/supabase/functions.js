// firebase/functions on Supabase: there are no Cloud Functions here; every
// callable goes to the trusted server at /api/ledger with the session token,
// in the callable's own envelope ({ data } / { code, message, details }).
import { getAuth } from './auth.js';

export const getFunctions = () => ({ type: 'functions' });
export function httpsCallable(_functions, name) {
  return async (data = {}) => {
    const auth = getAuth();
    await auth._ready;
    if (!auth.currentUser) throw Object.assign(new Error('تسجيل الدخول مطلوب.'), { code: 'unauthenticated' });
    const token = await auth.currentUser.getIdToken();
    const res = await fetch('/api/ledger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, data }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.error) {
      const e = body?.error || {};
      throw Object.assign(new Error(e.message || 'تعذّر إتمام العملية.'), { code: e.code || 'internal', details: e.details });
    }
    return { data: body?.result };
  };
}
export function connectFunctionsEmulator() { /* not applicable */ }
