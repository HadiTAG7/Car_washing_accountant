import { useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { mapPartnerPayment, toPartnerPaymentInsert } from '../lib/mappers';
import { useSupabaseQuery } from './useSupabaseQuery';

export function usePartnerPayments() {
  const { data, loading, error, refetch } = useSupabaseQuery(
    // Explicit column list — never `select('*')`. Avoids stale-cache
    // surprises and documents the shape the mapper depends on.
    () => supabase
      .from('partner_payments')
      .select('id, partner_id, amount, payment_date, payment_method, notes, created_at')
      .order('payment_date', { ascending: false })
      .order('created_at',  { ascending: false }),
    {
      enabled: isSupabaseConfigured,
      map:     mapPartnerPayment,
      fallback: [],
    },
  );

  const addPayment = useCallback(async (payment) => {
    if (!isSupabaseConfigured) return null;
    const payload = toPartnerPaymentInsert(payment);
    const { error: err } = await supabase
      .from('partner_payments')
      .insert(payload);
    if (err) {
      console.error('🔥 Real Supabase Error (partner_payments.insert):', err, 'payload:', payload);
      throw err;
    }
    await refetch();
  }, [refetch]);

  const deletePayment = useCallback(async (id) => {
    if (!isSupabaseConfigured) return null;
    const { error: err } = await supabase
      .from('partner_payments')
      .delete()
      .eq('id', id);
    if (err) {
      console.error('🔥 Real Supabase Error (partner_payments.delete):', err, 'id:', id);
      throw err;
    }
    await refetch();
  }, [refetch]);

  const payments = isSupabaseConfigured ? (data ?? []) : (data || []);
  return { payments, loading, error, addPayment, deletePayment, refetch };
}
