import { useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { mapAnnualExpenseEntry, toAnnualExpenseEntryInsert } from '../lib/mappers';
import { useSupabaseQuery } from './useSupabaseQuery';

/**
 * Sub-ledger for one annual_expenses row — mirror of useStartupCostEntries.
 * Fetches every entry whose annual_expense_id matches `parentId`, lets the
 * caller add/delete entries, and after every mutation keeps TWO parent
 * fields synced:
 *
 *   actual_amount  = SUM(entries.amount)
 *   payment_status = 'paid' when the sum covers annual_cost, else 'pending'
 *
 * The status sync means recording payments step by step flips the table's
 * pill to "مدفوع" automatically the moment the expense is fully paid —
 * no manual toggle needed (though the pill stays manually toggleable for
 * admins who don't itemize).
 *
 * Pass `parentId = null` to skip fetching (cheap to call from a closed
 * modal).
 */
export function useAnnualExpenseEntries(parentId) {
  const { data, loading, error, refetch } = useSupabaseQuery(
    () => supabase
      .from('annual_expense_entries')
      .select('id, annual_expense_id, description, amount, spent_date, notes, invoice_url, is_tax_invoice, created_at')
      .eq('annual_expense_id', parentId)
      .order('spent_date',  { ascending: false })
      .order('created_at',  { ascending: false }),
    {
      enabled: isSupabaseConfigured && Boolean(parentId),
      deps:    [parentId],
      map:     mapAnnualExpenseEntry,
      fallback: [],
    },
  );

  // Recompute SUM(amount) for this parent and push it onto
  // annual_expenses.actual_amount + derive payment_status against the
  // parent's annual_cost — both in one UPDATE. We re-query rather than
  // trust the local snapshot (it's one render behind the mutation).
  async function syncParentTotal() {
    if (!isSupabaseConfigured || !parentId) return;
    const [{ data: rows, error: sumErr }, { data: parent, error: parentErr }] = await Promise.all([
      supabase
        .from('annual_expense_entries')
        .select('amount')
        .eq('annual_expense_id', parentId),
      supabase
        .from('annual_expenses')
        .select('annual_cost')
        .eq('id', parentId)
        .single(),
    ]);
    if (sumErr || parentErr) {
      console.error('🔥 Real Supabase Error (annual_entries.sum):', sumErr || parentErr);
      return;
    }
    const total      = (rows || []).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const annualCost = Number(parent?.annual_cost) || 0;
    const { error: upErr } = await supabase
      .from('annual_expenses')
      .update({
        actual_amount:  total,
        payment_status: annualCost > 0 && total >= annualCost ? 'paid' : 'pending',
      })
      .eq('id', parentId);
    if (upErr) {
      console.error('🔥 Real Supabase Error (annual_expenses.sync_total):', upErr);
    }
  }

  const addEntry = useCallback(async (entry) => {
    if (!isSupabaseConfigured) return null;
    const payload = toAnnualExpenseEntryInsert({ ...entry, annualExpenseId: parentId });
    const { error: err } = await supabase
      .from('annual_expense_entries')
      .insert(payload);
    if (err) {
      console.error('🔥 Real Supabase Error (annual_expense_entries.insert):', err, 'payload:', payload);
      throw err;
    }
    await syncParentTotal();
    await refetch();
  // syncParentTotal closes over parentId and the stable supabase import —
  // refetch is the only dep that varies.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetch, parentId]);

  const deleteEntry = useCallback(async (id) => {
    if (!isSupabaseConfigured) return null;
    const { error: err } = await supabase
      .from('annual_expense_entries')
      .delete()
      .eq('id', id);
    if (err) {
      console.error('🔥 Real Supabase Error (annual_expense_entries.delete):', err, 'id:', id);
      throw err;
    }
    await syncParentTotal();
    await refetch();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetch, parentId]);

  const entries = isSupabaseConfigured ? (data ?? []) : (data || []);
  return { entries, loading, error, addEntry, deleteEntry, refetch };
}
