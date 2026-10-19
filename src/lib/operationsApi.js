import { auth } from './firebaseClient';

const endpoints = new Set(['operations-reports']);
export async function callOperationsApi(endpoint, input, signal) {
  if (!endpoints.has(endpoint)) throw new Error('مسار العمليات غير معروف.');
  if (!auth.currentUser) throw new Error('تسجيل الدخول مطلوب.');
  const token = await auth.currentUser.getIdToken();
  const response = await fetch(`/api/${endpoint}`, { method: 'POST', cache: 'no-store', redirect: 'error', signal: signal || AbortSignal.timeout(55000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(input) });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.error || !body || !Object.hasOwn(body, 'result')) throw new Error(body?.error?.message || 'تعذر تحميل العمليات؛ لم تُستبدل البيانات بأصفار.');
  return body.result;
}
