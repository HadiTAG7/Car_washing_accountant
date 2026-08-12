import { useCallback } from 'react';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { useFirestoreQuery } from './useFirestoreQuery';
import {
  fetchAccountingSettings, setTaxPolicy, seedTaxPolicy, saveAccountingPreferences,
  DEFAULT_ACCOUNTING_SETTINGS,
} from '../lib/accounting/accountingSettings';
import { taxPolicyAt, taxPolicyBaselineDate, hasTaxPolicyHistory } from '../lib/accounting/taxPolicy';

/**
 * Accounting policy switches. Falls back to the defaults while loading and in
 * demo mode, so a page never has to guard on `settings && …` — and a missing
 * settings document can never accidentally read as "auto-post is on".
 *
 * Writes go through callables: `app_settings/accounting` is denied to clients
 * in the rules, because a policy row decides what every wash in a period means
 * and a browser `setDoc` gave that no transaction, no audit record and no gate.
 */
export function useAccountingSettings() {
  const { data, loading, error, refetch } = useFirestoreQuery(fetchAccountingSettings, {
    enabled: isFirebaseConfigured,
    fallback: DEFAULT_ACCOUNTING_SETTINGS,
  });

  const settings = data || DEFAULT_ACCOUNTING_SETTINGS;

  /** The tax triple, with the date it takes effect. */
  const setPolicy = useCallback(async (payload) => {
    const next = await setTaxPolicy(payload);
    await refetch();
    return next;
  }, [refetch]);

  /** Records the baseline without changing anything. */
  const seedPolicy = useCallback(async (payload) => {
    const next = await seedTaxPolicy(payload);
    await refetch();
    return next;
  }, [refetch]);

  /** Auto-posting and filing frequency — no past figure moves with them. */
  const update = useCallback(async (patch) => {
    const next = await saveAccountingPreferences(patch);
    await refetch();
    return next;
  }, [refetch]);

  return {
    settings, loading, error, refetch,
    update, setPolicy, seedPolicy,
    // The record's own answers, so a page never re-derives them.
    policyAt: (date) => taxPolicyAt(date, settings),
    baselineFrom: taxPolicyBaselineDate(settings),
    policyConfigured: hasTaxPolicyHistory(settings),
  };
}
