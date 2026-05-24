import { useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import {
  mapTemporaryExpense,
  toTemporaryExpenseInsert,
  toTemporaryExpenseUpdate,
} from '../lib/mappers';
import { todayISO } from '../data/initialData';
import { useSupabaseQuery } from './useSupabaseQuery';

export function useTemporaryExpenses() {
  const { data, loading, error, refetch } = useSupabaseQuery(
    // Explicit column list — never `select('*')`. Avoids stale-cache
    // surprises and documents the shape the mapper depends on.
    () => supabase
      .from('temporary_expenses')
      .select('id, title, amount, spent_date, status, recovered_date, notes, created_at')
      .order('spent_date',  { ascending: false })
      .order('created_at',  { ascending: false }),
    {
      enabled: isSupabaseConfigured,
      map:     mapTemporaryExpense,
      fallback: [],
    },
  );

  const addTemporaryExpense = useCallback(async (expense) => {
    if (!isSupabaseConfigured) return null;
    const payload = toTemporaryExpenseInsert(expense);
    const { error: err } = await supabase
      .from('temporary_expenses')
      .insert(payload);
    if (err) {
      console.error('🔥 Real Supabase Error (temporary_expenses.insert):', err, 'payload:', payload);
      throw err;
    }
    await refetch();
  }, [refetch]);

  // Flip pending ↔ recovered. The DB CHECK constraint requires
  // recovered_date to be set iff status='recovered', so the update payload
  // always sends both fields together.
  const toggleRecoveryStatus = useCallback(async (id, currentStatus) => {
    if (!isSupabaseConfigured) return null;
    const nextStatus = currentStatus === 'recovered' ? 'pending' : 'recovered';
    const payload = toTemporaryExpenseUpdate({
      status:        nextStatus,
      recoveredDate: nextStatus === 'recovered' ? todayISO() : null,
    });
    const { error: err } = await supabase
      .from('temporary_expenses')
      .update(payload)
      .eq('id', id);
    if (err) {
      console.error('🔥 Real Supabase Error (temporary_expenses.toggleRecoveryStatus):', err, 'id:', id, 'payload:', payload);
      throw err;
    }
    await refetch();
  }, [refetch]);

  const deleteTemporaryExpense = useCallback(async (id) => {
    if (!isSupabaseConfigured) return null;
    const { error: err } = await supabase
      .from('temporary_expenses')
      .delete()
      .eq('id', id);
    if (err) {
      console.error('🔥 Real Supabase Error (temporary_expenses.delete):', err, 'id:', id);
      throw err;
    }
    await refetch();
  }, [refetch]);

  const expenses = isSupabaseConfigured ? (data ?? []) : (data || []);
  return {
    expenses,
    loading,
    error,
    addTemporaryExpense,
    toggleRecoveryStatus,
    deleteTemporaryExpense,
    refetch,
  };
}
