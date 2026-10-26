import { useAuth } from './useAuth';
import { usePartnerView } from '../contexts/PartnerViewContext';
import { useFirestoreQuery } from './useFirestoreQuery';
import { fetchRows } from '../lib/firestoreCrud';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { callServer } from '../lib/ledgerTransport';
import { invalidateCollections } from '../lib/readCache';
import { fleetIdentity } from '../lib/fleet';
import { mapBiker } from '../lib/mappers';
const collections = ['fleet_bikes', 'fleet_assignments', 'fleet_maintenance', 'fleet_incidents', 'fleet_policies', 'bikers', 'startup_costs'];
export async function newFleetId(kind, data) {
  if (kind !== 'bike') return crypto.randomUUID();
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fleetIdentity(data.internalNumber)));
  return 'bike-' + [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('');
}
export function useFleet() {
  const { user } = useAuth(), { role, isPartnerView } = usePartnerView();
  const allowed = !isPartnerView && ['admin', 'accountant'].includes(role);
  const query = useFirestoreQuery(async () => {
    const values = await Promise.all(collections.map(collection => fetchRows(collection)));
    return { bikes: values[0], assignments: values[1], maintenance: values[2], incidents: values[3], policies: values[4], bikers: values[5].map(mapBiker), startup: values[6] };
  }, { enabled: allowed && isFirebaseConfigured && Boolean(user?.id), preserveResult: true, cacheKey: 'fleet', cacheTags: collections,
    queryKey: `${user?.id || ''}:${role}:${isPartnerView}`, fallback: null });
  return { ...query, allowed, canEdit: role === 'admin' && !isPartnerView,
    save: async ({ kind, id, expectedRevision = 0, data }, { refresh = true } = {}) => {
      const result = await callServer('fleetSave', { kind, id: id || await newFleetId(kind, data), expectedRevision, data });
      invalidateCollections([...collections.filter(c => c.startsWith('fleet_')), 'audit_logs']);
      if (refresh) await query.refetch(); return result;
    } };
}
export function useFleetAvailability(enabled = true) {
  const { user } = useAuth(), { role, isPartnerView } = usePartnerView();
  const allowed = enabled && !isPartnerView && ['admin', 'accountant'].includes(role);
  return useFirestoreQuery(async () => {
    const [bikes, maintenance] = await Promise.all([fetchRows('fleet_bikes'), fetchRows('fleet_maintenance')]);
    return { registered: bikes.length, available: bikes.filter(b => b.status === 'working' && !b.currentBikerId && !b.activeAssignmentId
      && !maintenance.some(m => m.bikeId === b.id && !m.endedOn)).length };
  }, { enabled: allowed && isFirebaseConfigured && Boolean(user?.id), preserveResult: true, cacheKey: 'fleetAvailability', cacheTags: ['fleet_bikes', 'fleet_assignments', 'fleet_maintenance'],
    queryKey: `${user?.id || ''}:${role}:${isPartnerView}`, fallback: null });
}
