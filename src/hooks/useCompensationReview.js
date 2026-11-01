import { useEffect, useState } from 'react';
import { useAuth } from './useAuth';
import { usePartnerView } from '../contexts/PartnerViewContext';
import { auth } from '../lib/firebaseClient';
import { invalidateCollections } from '../lib/readCache';
export async function callCompensationReview(input, signal) {
  if (!auth.currentUser) throw Error('تسجيل الدخول مطلوب.');
  const token = await auth.currentUser.getIdToken();
  const response = await fetch('/api/compensation-review', { method: 'POST', cache: 'no-store', redirect: 'error', signal,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(input) });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || body.error || !body.result) throw Error(body?.error?.message || 'تعذرت القراءة؛ لا تكرر الحفظ قبل إعادة قراءة السجل.');
  if (input.op !== 'read') invalidateCollections(['quality_objections', 'audit_logs']);
  return body.result;
}
export function useCompensationReview() {
  const { user } = useAuth(), { role, isPartnerView } = usePartnerView();
  const allowed = role === 'admin' && !isPartnerView && Boolean(user?.id);
  const [state, setState] = useState({ data: null, error: '', key: '' }), [version, setVersion] = useState(0);
  const key = JSON.stringify([user?.id, role, isPartnerView, version]);
  useEffect(() => {
    if (!allowed) return undefined;
    const controller = new AbortController();
    callCompensationReview({ op: 'read' }, controller.signal).then(data => setState({ data, error: '', key }))
      .catch(e => { if (e.name !== 'AbortError') setState({ data: null, error: e.message, key }); });
    return () => controller.abort();
  }, [allowed, key]);
  return { allowed, data: allowed && state.key === key ? state.data : null, error: allowed && state.key === key ? state.error : '',
    loading: allowed && state.key !== key, refresh: () => setVersion(v => v + 1) };
}

