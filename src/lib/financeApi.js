import { auth } from './firebaseClient';
import { invalidateAllReads, refreshCollections } from './readCache';

const endpoints = new Set(['finance-reports', 'finance-workbench']);
// Finance actions that only read. Anything else (a save, an approval, a posting
// from the workbench or the founding page) may write entries, locks and sources
// at once, so every cached read is dropped and re-read on next use — otherwise
// the trial balance and the ledger keep showing the journal from before it.
const READ_ONLY_ACTIONS = new Set(['browse', 'list', 'options', 'read', 'preview', 'previewCapture', 'statementSuggest', 'manualEntries']);
const actionOf = input => (input?.kind === 'founding' ? input?.request?.action : input?.action);
// Actions that write journal entries: the founding settlement's «postEntries», a
// document's «post», and a cash correction's «save».
const CORRECTIONS = new Set(['cash_bank_correction', 'cash_residual_correction', 'payroll_cash_funding']);
const postsEntries = input => actionOf(input) === (input?.kind === 'founding' ? 'postEntries' : CORRECTIONS.has(input?.kind) ? 'save' : 'post');
export const LEDGER_COLLECTIONS = Object.freeze(['journal_entries', 'journal_lines', 'posting_locks']);

export async function callFinanceApi(endpoint, input, signal) {
  if (!endpoints.has(endpoint)) throw new Error('مسار المالية غير معروف.');
  if (!auth.currentUser) throw new Error('تسجيل الدخول مطلوب.');
  const token = await auth.currentUser.getIdToken();
  const writes = !READ_ONLY_ACTIONS.has(actionOf(input)), posts = postsEntries(input);
  let refused = false;
  try {
    const response = await fetch(`/api/${endpoint}`, { method: 'POST', cache: 'no-store', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(input) });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.error || !body || !Object.hasOwn(body, 'result')) {
      refused = Boolean(body?.error);
      throw new Error(body?.error?.message || 'تعذر تحميل المالية؛ لم تُستبدل البيانات بأصفار.');
    }
    return body.result;
  } finally {
    // A failed or interrupted write may still have committed; re-reading is the safe side.
    if (writes) invalidateAllReads();
    // After a posting the ledger on screen re-reads now, in this tab and the app's other open tabs.
    if (posts && !refused) refreshCollections(LEDGER_COLLECTIONS);
  }
}
