import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { mapStartupCostEntry } from '../lib/mappers';
import { useSupabaseQuery } from './useSupabaseQuery';

/**
 * Read-only feed of every startup-cost entry flagged as a tax invoice,
 * across ALL startup items. Powers the "الضريبة المستردة" report page —
 * the VAT portion of each amount is derived on the page via extractVat,
 * not stored, so this hook just surfaces the rows + their inclusive
 * amounts and leaves the math to the consumer.
 *
 * Mutations stay in StartupItemDetailModal (per-parent useStartupCostEntries);
 * this hook deliberately exposes none.
 */
export function useTaxInvoices() {
  const { data, loading, error, refetch } = useSupabaseQuery(
    () => supabase
      .from('startup_cost_entries')
      .select('id, startup_cost_id, description, amount, spent_date, notes, invoice_url, is_tax_invoice, created_at')
      .eq('is_tax_invoice', true)
      .order('spent_date', { ascending: false })
      .order('created_at', { ascending: false }),
    {
      enabled: isSupabaseConfigured,
      map:     mapStartupCostEntry,
      fallback: [],
    },
  );

  const invoices = isSupabaseConfigured ? (data ?? []) : (data || []);
  return { invoices, loading, error, refetch };
}
