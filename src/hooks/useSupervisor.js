import { callServer } from '../lib/ledgerTransport';
import { useAuth } from './useAuth';
import { usePartnerView } from '../contexts/PartnerViewContext';
import { useFirestoreQuery } from './useFirestoreQuery';

export function useSupervisorOverview(periodKey) {
  const { user } = useAuth();
  const { role } = usePartnerView();
  return useFirestoreQuery(() => callServer('supervisorOverview', { periodKey }), {
    enabled: Boolean(user?.id && ['supervisor', 'admin'].includes(role)),
    queryKey: `${user?.id || ''}:${role}:${periodKey}`, preserveResult: true,
  });
}
export function useSupervisorRecords(collection, cursor = null) {
  const { user } = useAuth();
  const { role } = usePartnerView();
  return useFirestoreQuery(() => callServer('supervisorRecords', { collection, cursor, limit: 50 }), {
    enabled: Boolean(user?.id && ['supervisor', 'admin'].includes(role)),
    queryKey: `${user?.id || ''}:${role}:${collection}:${cursor || ''}`, preserveResult: true,
  });
}
