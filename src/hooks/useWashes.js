import { useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { mapWash, toWashInsert, toWashUpdate } from '../lib/mappers';
import { useSupabaseQuery } from './useSupabaseQuery';

export function useWashes() {
  const { data, loading, error, refetch } = useSupabaseQuery(
    () => supabase
      .from('washes')
      // Explicit column list — never `select('*')`.
      .select('id, vehicle_type, plate_number, service_type, biker_name, price, status, wash_date, created_at, updated_at')
      .order('wash_date', { ascending: false, nullsFirst: false }),
    {
      enabled: isSupabaseConfigured,
      map:     mapWash,
    },
  );

  const addItem = useCallback(async (item) => {
    if (!isSupabaseConfigured) return null;
    const payload = toWashInsert(item);
    const { error: err } = await supabase
      .from('washes')
      .insert(payload);
    if (err) {
      console.error('Supabase Wash Insert Error:', err, 'payload:', payload);
      throw err;
    }
    await refetch();
  }, [refetch]);

  const updateItem = useCallback(async (id, updates) => {
    if (!isSupabaseConfigured) return null;
    const payload = toWashUpdate(updates);
    if (Object.keys(payload).length === 0) return null;
    const { error: err } = await supabase
      .from('washes')
      .update(payload)
      .eq('id', id);
    if (err) {
      console.error('Supabase Wash Update Error:', err, 'payload:', payload);
      throw err;
    }
    await refetch();
  }, [refetch]);

  const updateStatus = useCallback(async (id, status) => {
    if (!isSupabaseConfigured) return null;
    const safe = status === 'قيد التنفيذ' ? 'قيد التنفيذ' : 'مكتملة';
    const { error: err } = await supabase
      .from('washes')
      .update({ status: safe })
      .eq('id', id);
    if (err) throw err;
    await refetch();
  }, [refetch]);

  const deleteItem = useCallback(async (id) => {
    if (!isSupabaseConfigured) return null;
    const { error: err } = await supabase
      .from('washes')
      .delete()
      .eq('id', id);
    if (err) throw err;
    await refetch();
  }, [refetch]);

  const items = data ?? [];
  return { items, loading, error, addItem, updateItem, updateStatus, deleteItem, refetch };
}
