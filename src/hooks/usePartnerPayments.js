import { useCallback } from 'react';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import {
  fetchRows, getRow, runBatch, sortBy, where,
} from '../lib/firestoreCrud';
import { mapPartnerPayment, toPartnerPaymentInsert } from '../lib/mappers';
import { useFirestoreQuery } from './useFirestoreQuery';

// Recompute a partner's total from a set of payment rows.
const sumAmounts = (rows) => rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

export function usePartnerPayments() {
  const { data, loading, error, refetch } = useFirestoreQuery(
    async () => sortBy(await fetchRows('partner_payments'), [
      { key: 'payment_date', dir: 'desc' },
      { key: 'created_at',   dir: 'desc' },
    ]),
    {
      enabled: isFirebaseConfigured,
      map:     mapPartnerPayment,
      fallback: [],
    },
  );

  // Firestore has no server-side trigger, so we keep the Supabase invariant
  // (partners.paid_amount == SUM of that partner's receipts) with an ATOMIC
  // batched write: the receipt and the partner aggregate commit together or
  // not at all — no drift window.
  const addPayment = useCallback(async (payment) => {
    if (!isFirebaseConfigured) return null;
    const body = toPartnerPaymentInsert(payment);
    const partnerId = body.partner_id;
    body.created_at = new Date().toISOString();
    const existing = await fetchRows('partner_payments', [where('partner_id', '==', partnerId)]);
    const newTotal = sumAmounts(existing) + (Number(body.amount) || 0);
    const paymentId = (globalThis.crypto || window.crypto).randomUUID();
    await runBatch([
      { type: 'set',    path: 'partner_payments', id: paymentId, data: body },
      { type: 'update', path: 'partners',         id: partnerId, data: { paid_amount: newTotal } },
    ]);
    await refetch();
  }, [refetch]);

  const deletePayment = useCallback(async (id) => {
    if (!isFirebaseConfigured) return null;
    const row = await getRow('partner_payments', id);
    if (!row) { await refetch(); return; }
    const partnerId = row.partner_id;
    const remaining = (await fetchRows('partner_payments', [where('partner_id', '==', partnerId)]))
      .filter((r) => r.id !== id);
    await runBatch([
      { type: 'delete', path: 'partner_payments', id },
      { type: 'update', path: 'partners', id: partnerId, data: { paid_amount: sumAmounts(remaining) } },
    ]);
    await refetch();
  }, [refetch]);

  const payments = isFirebaseConfigured ? (data ?? []) : (data || []);
  return { payments, loading, error, addPayment, deletePayment, refetch };
}
