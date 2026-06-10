import { useMemo } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { mapStartupCostEntry, mapAnnualExpenseEntry } from '../lib/mappers';
import { useSupabaseQuery } from './useSupabaseQuery';

/**
 * Read-only feed of every ledger entry flagged as a tax invoice, across
 * BOTH sources: startup_cost_entries and annual_expense_entries. Powers
 * the "الضريبة المستردة" report page — the VAT portion of each amount is
 * derived on the page via extractVat, not stored.
 *
 * Each row is tagged with `source: 'startup' | 'annual'` and carries a
 * unified `parentId` so the page can resolve the parent item's name from
 * the matching items hook. Two queries (Supabase JS can't UNION across
 * tables) merged + sorted by spent_date desc client-side.
 *
 * Mutations stay in the per-parent ledger hooks; this hook exposes none.
 */
const ENTRY_COLUMNS = 'id, description, amount, spent_date, notes, invoice_url, is_tax_invoice, created_at';

export function useTaxInvoices() {
  const startupQ = useSupabaseQuery(
    () => supabase
      .from('startup_cost_entries')
      .select(`${ENTRY_COLUMNS}, startup_cost_id`)
      .eq('is_tax_invoice', true)
      .order('spent_date', { ascending: false })
      .order('created_at', { ascending: false }),
    {
      enabled: isSupabaseConfigured,
      map:     mapStartupCostEntry,
      fallback: [],
    },
  );

  const annualQ = useSupabaseQuery(
    () => supabase
      .from('annual_expense_entries')
      .select(`${ENTRY_COLUMNS}, annual_expense_id`)
      .eq('is_tax_invoice', true)
      .order('spent_date', { ascending: false })
      .order('created_at', { ascending: false }),
    {
      enabled: isSupabaseConfigured,
      map:     mapAnnualExpenseEntry,
      fallback: [],
    },
  );

  const invoices = useMemo(() => {
    const startup = (startupQ.data || []).map((e) => ({
      ...e, source: 'startup', parentId: e.startupCostId,
    }));
    const annual = (annualQ.data || []).map((e) => ({
      ...e, source: 'annual', parentId: e.annualExpenseId,
    }));
    // Newest spend first; created_at desc breaks same-day ties.
    return [...startup, ...annual].sort((a, b) => {
      const byDate = String(b.spentDate).localeCompare(String(a.spentDate));
      return byDate !== 0 ? byDate : String(b.createdAt).localeCompare(String(a.createdAt));
    });
  }, [startupQ.data, annualQ.data]);

  // NOTE on errors: the annual entries table ships later than startup's —
  // a "relation does not exist" on one source shouldn't blank the whole
  // report. Surface the startup error first (older feature, more likely
  // a real problem); the annual error only when startup is clean.
  const loading = startupQ.loading || annualQ.loading;
  const error   = startupQ.error || annualQ.error || null;
  const refetch = () => { startupQ.refetch(); annualQ.refetch(); };

  return { invoices, loading, error, refetch };
}
