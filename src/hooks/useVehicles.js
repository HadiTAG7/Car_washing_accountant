import { useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { mapVehicle, toVehicleInsert } from '../lib/mappers';
import { initialVehiclePerformance } from '../data/initialData';
import { useSupabaseQuery } from './useSupabaseQuery';

const FALLBACK = initialVehiclePerformance.map((v) => ({
  id:                  v.id,
  vehicleName:         v.vehicleName,
  route:               v.route,
  assetCost:           v.assetCost,
  allocatedFixedCosts: v.allocatedFixedCosts,
}));

export function useVehicles() {
  const { data, loading, error, refetch } = useSupabaseQuery(
    () => supabase.from('vehicles').select('*').order('vehicle_name'),
    {
      enabled: isSupabaseConfigured,
      map:     mapVehicle,
      fallback: FALLBACK,
    },
  );

  const addVehicle = useCallback(async (vehicle) => {
    if (!isSupabaseConfigured) return null;
    const { error: err } = await supabase
      .from('vehicles')
      .insert(toVehicleInsert(vehicle));
    if (err) throw err;
    await refetch();
  }, [refetch]);

  const deleteVehicle = useCallback(async (id) => {
    if (!isSupabaseConfigured) return null;
    const { error: err } = await supabase.from('vehicles').delete().eq('id', id);
    if (err) throw err;
    await refetch();
  }, [refetch]);

  return { vehicles: data || FALLBACK, loading, error, addVehicle, deleteVehicle, refetch };
}
