import { useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { mapStartupCostEntry, toStartupCostEntryInsert } from '../lib/mappers';
import { useSupabaseQuery } from './useSupabaseQuery';

/**
 * Sub-ledger for one startup_costs row. Fetches every entry whose
 * startup_cost_id matches `parentId`, lets the caller add/delete
 * entries, and keeps the parent's `actual_amount` synced to the SUM
 * of its entries on every mutation.
 *
 * The roll-up is client-driven (no DB trigger) — matches the pattern
 * already used for variable expenses, and avoids a second migration
 * to provision the trigger function. The trade-off is honest: if a
 * second client mutates entries concurrently the parent sum can
 * briefly drift, but the next refetch corrects it.
 *
 * Pass `parentId = null` to skip fetching (the hook is intentionally
 * cheap to call from a closed modal).
 */
export function useStartupCostEntries(parentId) {
  const { data, loading, error, refetch } = useSupabaseQuery(
    () => supabase
      .from('startup_cost_entries')
      .select('id, startup_cost_id, description, amount, spent_date, notes, invoice_url, is_tax_invoice, created_at')
      .eq('startup_cost_id', parentId)
      .order('spent_date',  { ascending: false })
      .order('created_at',  { ascending: false }),
    {
      enabled: isSupabaseConfigured && Boolean(parentId),
      deps:    [parentId],
      map:     mapStartupCostEntry,
      fallback: [],
    },
  );

  // Recompute SUM(amount) across all entries for this parent and push
  // it onto startup_costs.actual_amount. Runs after every add/delete so
  // the inline table cell stays coherent without a manual "refresh"
  // button. We re-query rather than trust the local `data` snapshot —
  // the snapshot is one render behind the just-completed mutation.
  async function syncParentTotal() {
    if (!isSupabaseConfigured || !parentId) return;
    const { data: rows, error: sumErr } = await supabase
      .from('startup_cost_entries')
      .select('amount')
      .eq('startup_cost_id', parentId);
    if (sumErr) {
      console.error('🔥 Real Supabase Error (entries.sum):', sumErr);
      return;
    }
    const total = (rows || []).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const { error: upErr } = await supabase
      .from('startup_costs')
      .update({ actual_amount: total })
      .eq('id', parentId);
    if (upErr) {
      console.error('🔥 Real Supabase Error (startup_costs.sync_total):', upErr);
    }
  }

  const addEntry = useCallback(async (entry) => {
    if (!isSupabaseConfigured) return null;
    const payload = toStartupCostEntryInsert({ ...entry, startupCostId: parentId });
    const { error: err } = await supabase
      .from('startup_cost_entries')
      .insert(payload);
    if (err) {
      console.error('🔥 Real Supabase Error (startup_cost_entries.insert):', err, 'payload:', payload);
      throw err;
    }
    await syncParentTotal();
    await refetch();
  // syncParentTotal closes over parentId and supabase (stable module
  // import) — refetch is the only dep that varies.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetch, parentId]);

  const deleteEntry = useCallback(async (id) => {
    if (!isSupabaseConfigured) return null;
    const { error: err } = await supabase
      .from('startup_cost_entries')
      .delete()
      .eq('id', id);
    if (err) {
      console.error('🔥 Real Supabase Error (startup_cost_entries.delete):', err, 'id:', id);
      throw err;
    }
    await syncParentTotal();
    await refetch();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetch, parentId]);

  const entries = isSupabaseConfigured ? (data ?? []) : (data || []);
  return { entries, loading, error, addEntry, deleteEntry, refetch };
}
