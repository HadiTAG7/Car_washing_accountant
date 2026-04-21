import { useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { mapTransaction, toTransactionInsert } from '../lib/mappers';
import { initialCashTransactions } from '../data/initialData';
import { useSupabaseQuery } from './useSupabaseQuery';

const FALLBACK = initialCashTransactions.map((t) => ({
  id:          t.id,
  date:        t.date,
  description: t.description,
  type:        t.type,
  amount:      t.amount,
  vehicleId:   null,
}));

export function useTransactions() {
  const { data, loading, error, refetch } = useSupabaseQuery(
    () =>
      supabase
        .from('transactions')
        .select('*')
        .order('occurred_on', { ascending: false }),
    {
      enabled: isSupabaseConfigured,
      map:     mapTransaction,
      fallback: FALLBACK,
    },
  );

  const addTransaction = useCallback(async (tx) => {
    if (!isSupabaseConfigured) return null;
    const { error: err } = await supabase
      .from('transactions')
      .insert(toTransactionInsert(tx));
    if (err) throw err;
    await refetch();
  }, [refetch]);

  const deleteTransaction = useCallback(async (id) => {
    if (!isSupabaseConfigured) return null;
    const { error: err } = await supabase.from('transactions').delete().eq('id', id);
    if (err) throw err;
    await refetch();
  }, [refetch]);

  return { transactions: data || FALLBACK, loading, error, addTransaction, deleteTransaction, refetch };
}
