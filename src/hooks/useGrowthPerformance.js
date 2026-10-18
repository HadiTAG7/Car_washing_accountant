import { useEffect, useState } from 'react';
import { auth } from '../lib/firebaseClient';
import { useAuth } from './useAuth';
import { usePartnerView } from '../contexts/PartnerViewContext';

export function useGrowthPerformance(from, to) {
  const { session } = useAuth();
  const { role, isPartnerView } = usePartnerView();
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ key: '', data: null, error: null });
  const enabled = role === 'admin' && !isPartnerView && Boolean(session?.user?.id);
  const key = `${session?.user?.id}|${role}|${isPartnerView}|${from}|${to}|${revision}`;
  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let active = true;
    async function load() {
      try {
        const token = await auth.currentUser.getIdToken();
        const response = await fetch('/api/growth-performance', { method: 'POST', cache: 'no-store',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ from, to }) });
        const body = await response.json();
        if (!response.ok || body.error || !body.result) throw new Error(body.error?.message || 'تعذر تحميل بيانات النمو.');
        const value = body.result;
        if (value.from !== from || value.to !== to || !Array.isArray(value.workers)
          || !Array.isArray(value.exclusions) || !Array.isArray(value.gaps)
          || !Number.isFinite(Date.parse(value.readAt)) || !Number.isFinite(Date.parse(value.roster?.at))
          || value.workers.some(w => !w.id || !Array.isArray(w.days))) throw new Error('تعذر تحميل بيانات النمو.');
        if (active) setState({ key, data: body.result, error: null });
      } catch (error) {
        if (active) setState({ key, data: null, error: error.name === 'AbortError' ? 'تعذر تحميل بيانات النمو.' : error.message });
      } finally { clearTimeout(timeout); }
    }
    load();
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [enabled, key, from, to]);
  const current = enabled && state.key === key;
  return { allowed: enabled, loading: enabled && !current, data: current ? state.data : null,
    error: current ? state.error : null, retry: () => setRevision(x => x + 1) };
}
