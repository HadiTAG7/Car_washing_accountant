import { useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { mapPartner, toPartnerInsert, toPartnerUpdate } from '../lib/mappers';
import { useSupabaseQuery } from './useSupabaseQuery';

export function usePartners() {
  const { data, loading, error, refetch } = useSupabaseQuery(
    () => supabase.from('partners').select('*').order('partner_name'),
    {
      enabled: isSupabaseConfigured,
      map:     mapPartner,
      fallback: [],
    },
  );

  const addPartner = useCallback(async (partner) => {
    if (!isSupabaseConfigured) return null;
    const { error: err } = await supabase
      .from('partners')
      .insert(toPartnerInsert(partner));
    if (err) throw err;
    await refetch();
  }, [refetch]);

  const updatePartner = useCallback(async (id, patch) => {
    if (!isSupabaseConfigured) return null;
    const { error: err } = await supabase
      .from('partners')
      .update(toPartnerUpdate(patch))
      .eq('id', id);
    if (err) throw err;
    await refetch();
  }, [refetch]);

  const deletePartner = useCallback(async (id) => {
    if (!isSupabaseConfigured) return null;
    const { error: err } = await supabase.from('partners').delete().eq('id', id);
    if (err) throw err;
    await refetch();
  }, [refetch]);

  const partners = isSupabaseConfigured ? (data ?? []) : (data || []);
  return { partners, loading, error, addPartner, updatePartner, deletePartner, refetch };
}
