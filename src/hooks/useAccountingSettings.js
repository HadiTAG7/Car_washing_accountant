import { useCallback } from 'react';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { useFirestoreQuery } from './useFirestoreQuery';
import {
  fetchAccountingSettings, saveAccountingSettings, DEFAULT_ACCOUNTING_SETTINGS,
} from '../lib/accounting/accountingSettings';

/**
 * Accounting policy switches. Falls back to the defaults while loading and in
 * demo mode, so a page never has to guard on `settings && …` — and a missing
 * settings document can never accidentally read as "auto-post is on".
 */
export function useAccountingSettings() {
  const { data, loading, error, refetch } = useFirestoreQuery(fetchAccountingSettings, {
    enabled: isFirebaseConfigured,
    fallback: DEFAULT_ACCOUNTING_SETTINGS,
  });

  const settings = data || DEFAULT_ACCOUNTING_SETTINGS;

  const update = useCallback(async (patch, opts) => {
    const next = await saveAccountingSettings(patch, opts);
    await refetch();
    return next;
  }, [refetch]);

  return { settings, loading, error, update, refetch };
}
