import { useEffect, useState } from 'react';
import { useAuth } from './useAuth';
import { usePartnerView } from '../contexts/PartnerViewContext';
import { callOperationsApi } from '../lib/operationsApi';
import { onReadRefresh } from '../lib/readCache';
import { readLatestOperationsReview } from '../lib/latestOperationsReview';

export function useLatestOperationsReview(today) {
  const { session } = useAuth();
  const { role, isPartnerView } = usePartnerView();
  const allowed = role === 'admin' && !isPartnerView && Boolean(session?.user?.id);
  const [version, setVersion] = useState(0);
  const [state, setState] = useState({ key: '', report: null, error: null });
  const key = JSON.stringify([session?.user?.id, role, isPartnerView, today, version]);
  useEffect(() => onReadRefresh(() => setVersion(v => v + 1)), []);
  useEffect(() => {
    if (!allowed) return undefined;
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 55000);
    let current = true;
    readLatestOperationsReview((input, signal) => callOperationsApi('operations-reports', input, signal), today, controller.signal)
      .then(report => { if (current) setState({ key, report, error: null }); })
      .catch(() => { if (current) setState({ key, report: null, error: 'تعذرت قراءة مراجعة التشغيل؛ لا يمكن تأكيد التغطية الحالية.' }); })
      .finally(() => clearTimeout(timeout));
    return () => { current = false; clearTimeout(timeout); controller.abort(); };
  }, [allowed, key, today]);
  const visible = allowed && state.key === key;
  return { loading: allowed && !visible, report: visible ? state.report : null, error: visible ? state.error : null };
}
