import { useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { mapPartner, toPartnerInsert, toPartnerUpdate } from '../lib/mappers';
import { useSupabaseQuery } from './useSupabaseQuery';

export function usePartners() {
  const { data, loading, error, refetch } = useSupabaseQuery(
    // Explicit column list — never `select('*')`. Notably excludes any
    // `percentage` column: it's a client-derived value (workers_count /
    // total_workers × 100) and must never round-trip through the DB.
    () => supabase
      .from('partners')
      .select('id, partner_name, workers_count, paid_amount, contact_number, status, created_at')
      .order('partner_name'),
    {
      enabled: isSupabaseConfigured,
      map:     mapPartner,
      fallback: [],
    },
  );

  const addPartner = useCallback(async (partner) => {
    if (!isSupabaseConfigured) return null;
    const payload = toPartnerInsert(partner);
    const { error: err } = await supabase
      .from('partners')
      .insert(payload);
    if (err) {
      console.error('🔥 Real Supabase Error (partners.insert):', err, 'payload:', payload);
      throw err;
    }
    await refetch();
  }, [refetch]);

  const updatePartner = useCallback(async (id, patch) => {
    if (!isSupabaseConfigured) return null;
    const payload = toPartnerUpdate(patch);
    const { error: err } = await supabase
      .from('partners')
      .update(payload)
      .eq('id', id);
    if (err) {
      console.error('🔥 Real Supabase Error (partners.update):', err, 'id:', id, 'payload:', payload);
      throw err;
    }
    await refetch();
  }, [refetch]);

  const deletePartner = useCallback(async (id) => {
    if (!isSupabaseConfigured) return null;
    const { error: err } = await supabase.from('partners').delete().eq('id', id);
    if (err) {
      console.error('🔥 Real Supabase Error (partners.delete):', err, 'id:', id);
      throw err;
    }
    await refetch();
  }, [refetch]);

  const partners = isSupabaseConfigured ? (data ?? []) : (data || []);
  return { partners, loading, error, addPartner, updatePartner, deletePartner, refetch };
}
