import { useCallback } from 'react';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { fetchRows, runBatch, sortBy } from '../lib/firestoreCrud';
import { mapPartnerPayment, toPartnerPaymentInsert } from '../lib/mappers';
import { useFirestoreQuery } from './useFirestoreQuery';

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

  // A receipt touches `partner_payments` alone. The old read-then-sum into
  // `partners.paid_amount` raced (two devices could both write a stale total)
  // and needed write access to `partners`, which is now the admin's only.
  // Every paid-to-date figure is summed from the receipts themselves
  // (`lib/accounting/partnerTotals.js`), so nothing reads the cache.
  const addPayment = useCallback(async (payment) => {
    if (!isFirebaseConfigured) return null;
    const body = toPartnerPaymentInsert(payment);
    body.created_at = new Date().toISOString();
    const paymentId = (globalThis.crypto || window.crypto).randomUUID();
    await runBatch([{ type: 'set', path: 'partner_payments', id: paymentId, data: body }]);
    await refetch();
  }, [refetch]);

  const deletePayment = useCallback(async (id) => {
    if (!isFirebaseConfigured) return null;
    await runBatch([{ type: 'delete', path: 'partner_payments', id }]);
    await refetch();
  }, [refetch]);

  const payments = isFirebaseConfigured ? (data ?? []) : (data || []);
  return { payments, loading, error, addPayment, deletePayment, refetch };
}
