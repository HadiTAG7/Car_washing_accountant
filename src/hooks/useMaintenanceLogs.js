import { useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { mapMaintenanceLog, toMaintenanceInsert } from '../lib/mappers';
import { initialMaintenanceRecords } from '../data/initialData';
import { useSupabaseQuery } from './useSupabaseQuery';

// Offline fallback uses the seed records as-is (already in app shape)
const FALLBACK = initialMaintenanceRecords.map((r) => ({
  id:               r.id,
  vehicleId:        null,
  assetName:        r.assetName,
  maintenanceType:  r.maintenanceType,
  lastServiceDate:  r.lastServiceDate,
  nextServiceDate:  r.nextServiceDate,
  estimatedCost:    r.estimatedCost,
}));

export function useMaintenanceLogs() {
  const { data, loading, error, refetch } = useSupabaseQuery(
    () =>
      supabase
        .from('maintenance_logs')
        .select('*, vehicles(vehicle_name)')
        .order('next_service_date', { ascending: true }),
    {
      enabled: isSupabaseConfigured,
      map:     mapMaintenanceLog,
      fallback: FALLBACK,
    },
  );

  const addLog = useCallback(async (log) => {
    if (!isSupabaseConfigured) return null;
    const { error: err } = await supabase
      .from('maintenance_logs')
      .insert(toMaintenanceInsert(log));
    if (err) throw err;
    await refetch();
  }, [refetch]);

  const deleteLog = useCallback(async (id) => {
    if (!isSupabaseConfigured) return null;
    const { error: err } = await supabase
      .from('maintenance_logs')
      .delete()
      .eq('id', id);
    if (err) throw err;
    await refetch();
  }, [refetch]);

  return { logs: data || FALLBACK, loading, error, addLog, deleteLog, refetch };
}
