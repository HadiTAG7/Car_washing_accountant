import { useEffect, useState } from 'react';
import { useAuth } from './useAuth';
import { usePartnerView } from '../contexts/PartnerViewContext';
import { callFinanceApi } from '../lib/financeApi';

export function useFinanceRead(endpoint, request, enabled = true) {
  const { session } = useAuth();
  const { role, isPartnerView } = usePartnerView();
  const allowed = role === 'admin' && !isPartnerView && Boolean(session?.user?.id);
  const [version, setVersion] = useState(0);
  const [state, setState] = useState({ key: '', data: null, error: null });
  const requestKey = JSON.stringify(request);
  const key = JSON.stringify([session?.user?.id, role, isPartnerView, endpoint, requestKey, version]);
  useEffect(() => {
    if (!allowed || !enabled) return undefined;
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 55000);
    let current = true;
    callFinanceApi(endpoint, JSON.parse(requestKey), controller.signal)
      .then(data => { if (current) setState({ key, data, error: null }); })
      .catch(error => { if (current) setState({ key, data: null,
        error: error.name === 'AbortError' ? 'انتهت مهلة القراءة؛ لا توجد نتيجة متحققة.' : error.message }); })
      .finally(() => clearTimeout(timeout));
    return () => { current = false; clearTimeout(timeout); controller.abort(); };
  }, [allowed, enabled, endpoint, requestKey, key]);
  const visible = allowed && enabled && state.key === key;
  return { allowed, loading: allowed && enabled && !visible, data: visible ? state.data : null,
    error: visible ? state.error : null, refresh: () => setVersion(v => v + 1) };
}
