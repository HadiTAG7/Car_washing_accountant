import { auth } from './firebaseClient';
import { invalidateCollections } from './readCache';

export async function callBikerQuality(operation, data) {
  if (!auth?.currentUser) throw new Error('تسجيل الدخول مطلوب.');
  const token = await auth.currentUser.getIdToken();
  const response = await fetch('/api/biker-quality-reports', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ operation, data }), cache: 'no-store', signal: AbortSignal.timeout(30000) });
  const body = await response.json();
  if (!response.ok || body.error) {
    const error = new Error(body.error?.message || 'تعذّر تحميل أو حفظ تقرير الجودة.');
    error.code = body.error?.code;
    throw error;
  }
  // Reads leave the cache alone; a save or review changes the quality data.
  if (!['read', 'readMonth'].includes(operation)) invalidateCollections(['biker_quality_reports']);
  return body.result;
}
