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

  // Per-source errors: the two entry tables ship at different times — a
  // "relation does not exist" on one source must NOT blank the whole
  // report while the other loaded fine. `error` (only when BOTH failed)
  // drives the page-level ErrorState; `sourceErrors` lets the page show
  // a compact per-source note naming the missing migration instead.
  const loading = startupQ.loading || annualQ.loading;
  const error   = (startupQ.error && annualQ.error) ? startupQ.error : null;
  const sourceErrors = {
    startup: startupQ.error || null,
    annual:  annualQ.error  || null,
  };
  const refetch = () => { startupQ.refetch(); annualQ.refetch(); };

  return { invoices, loading, error, sourceErrors, refetch };
}
