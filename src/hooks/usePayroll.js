import { useCallback } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../lib/firebaseClient';
import { callServer } from '../lib/ledgerTransport';
import { fetchRows, sortBy } from '../lib/firestoreCrud';
import { useFirestoreQuery } from './useFirestoreQuery';

export function usePayrollRuns({ enabled = true } = {}) {
  const { data, loading, error, refetch } = useFirestoreQuery(
    async () => sortBy(await fetchRows('payroll_runs'), [{ key: 'periodKey', ascending: false }, { key: 'revision', ascending: false }]),
    { enabled: enabled && isFirebaseConfigured, fallback: [] },
  );

  const invoke = useCallback(async (name, payload) => {
    const result = await callServer(name, payload);
    await refetch();
    return result;
  }, [refetch]);

  return {
    runs: data || [],
    loading,
    error,
    refetch,
    preview: (payload) => callServer('payrollPreview', payload),
    saveDraft: (payload) => invoke('payrollSaveDraft', payload),
    approve: (runId) => invoke('payrollApprove', { runId }),
    unapprove: (runId, reason) => invoke('payrollUnapprove', { runId, reason }),
    pay: (payload) => invoke('payrollPay', payload),
    reverse: (payload) => invoke('payrollReverse', payload),
    cancel: (runId, reason) => invoke('payrollCancel', { runId, reason }),
  };
}

export function usePayrollItems(runId, { enabled = true } = {}) {
  return useFirestoreQuery(
    async () => {
      const snap = await getDocs(collection(db, 'payroll_runs', runId, 'items'));
      return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ar'));
    },
    { enabled: enabled && isFirebaseConfigured && Boolean(runId), deps: [runId], fallback: [] },
  );
}
