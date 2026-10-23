import { useEffect, useState } from 'react';
export async function callFinanceApi(endpoint, body, signal) {
  if (endpoint !== 'finance-workbench' || window.location.hostname !== '127.0.0.1' || window.location.port !== '5204') throw new Error('Isolated workbench test only');
  const response = await fetch('/__finance-workbench-test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Isolated test error'); return data.result;
}
export function useFinanceRead(endpoint, request, enabled = true) {
  const [revision, setRevision] = useState(0), [state, setState] = useState(null);
  const requestKey = JSON.stringify(request), key = `${endpoint}:${requestKey}:${revision}`;
  useEffect(() => {
    if (!enabled || endpoint !== 'finance-workbench') return;
    const controller = new AbortController();
    callFinanceApi(endpoint, JSON.parse(requestKey), controller.signal).then(data => setState({ key, data }), error => {
      if (error.name !== 'AbortError') setState({ key, error: error.message });
    });
    return () => controller.abort();
  }, [enabled, endpoint, requestKey, key]);
  return { allowed: true, loading: enabled && state?.key !== key, data: enabled && state?.key === key ? state.data : null,
    error: enabled && state?.key === key ? state.error : null, refresh: () => setRevision(value => value + 1) };
}
