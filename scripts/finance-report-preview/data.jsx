import { useEffect, useState } from 'react';
export async function callFinanceApi(endpoint, input, signal) {
  if (endpoint !== 'finance-reports' || window.location.hostname !== '127.0.0.1' || window.location.port !== '5205') throw new Error('Isolated finance report preview only');
  if (!['archive', 'read', 'forExecutive'].includes(input.action)) throw new Error('Read-only preview: publishing disabled');
  const response = await fetch('/__finance-report-test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal });
  const result = await response.json(); if (!response.ok) throw new Error(result.error); return result.result;
}
export function useFinanceRead(endpoint, input, enabled = true) {
  const [version, setVersion] = useState(0), [state, setState] = useState(null), request = JSON.stringify(input), key = `${request}:${version}`;
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    callFinanceApi(endpoint, JSON.parse(request), controller.signal).then(data => setState({ key, data }), error => { if (error.name !== 'AbortError') setState({ key, error: error.message }); });
    return () => controller.abort();
  }, [endpoint, enabled, request, key]);
  return { allowed: true, loading: enabled && state?.key !== key, data: enabled && state?.key === key ? state.data : null,
    error: enabled && state?.key === key ? state.error : null, refresh: () => setVersion(value => value + 1) };
}
export const useExecutiveDailyMetrics = () => ({ today: '2026-10-23' });
