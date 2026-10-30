import { auth } from './firebaseClient';
import { invalidateAllReads } from './readCache';

const endpoints = new Set(['finance-reports', 'finance-workbench']);
// Finance actions that only read. Anything else (a save, an approval, a posting
// from the workbench or the founding page) may write entries, locks and sources
// at once, so every cached read is dropped and re-read on next use — otherwise
// the trial balance and the ledger keep showing the journal from before it.
const READ_ONLY_ACTIONS = new Set(['browse', 'list', 'options', 'read', 'preview', 'previewCapture', 'statementSuggest']);
const actionOf = input => (input?.kind === 'founding' ? input?.request?.action : input?.action);

export async function callFinanceApi(endpoint, input, signal) {
  if (!endpoints.has(endpoint)) throw new Error('مسار المالية غير معروف.');
  if (!auth.currentUser) throw new Error('تسجيل الدخول مطلوب.');
  const token = await auth.currentUser.getIdToken();
  const writes = !READ_ONLY_ACTIONS.has(actionOf(input));
  try {
    const response = await fetch(`/api/${endpoint}`, { method: 'POST', cache: 'no-store', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(input) });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.error || !body || !Object.hasOwn(body, 'result')) throw new Error(body?.error?.message || 'تعذر تحميل المالية؛ لم تُستبدل البيانات بأصفار.');
    return body.result;
  } finally {
    // A failed or interrupted write may still have committed; re-reading is the safe side.
    if (writes) invalidateAllReads();
  }
}
