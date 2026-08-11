import { useCallback, useMemo } from 'react';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { fetchRows, insertRow, updateRow, deleteRow, sortBy } from '../lib/firestoreCrud';
import { useFirestoreQuery } from './useFirestoreQuery';

/**
 * قواعد رسوم الإدارة والإشراف — configured, never hard-coded.
 *
 * A management or supervisor fee is a business decision that changes over
 * time, so it lives in `fee_rules` with an EFFECTIVE DATE rather than as a
 * constant in the income statement. Changing the rate next quarter must not
 * silently restate last quarter's profit, which is exactly what a hard-coded
 * percentage would do.
 *
 * Document shape:
 *   { key, label, basis: 'revenue' | 'profit', rate, effectiveFrom, active }
 */
export function useFeeRules() {
  const { data, loading, error, refetch } = useFirestoreQuery(
    async () => sortBy(await fetchRows('fee_rules'), [{ key: 'effective_from' }]),
    { enabled: isFirebaseConfigured, fallback: [] },
  );

  const rules = useMemo(
    () => (data || [])
      .filter((r) => r.active !== false)
      .map((r) => ({
        id:    r.id,
        key:   r.key || r.id,
        label: r.label || 'رسوم',
        basis: r.basis === 'profit' ? 'profit' : 'revenue',
        rate:  Number(r.rate) || 0,
        effectiveFrom: r.effective_from || null,
      })),
    [data],
  );

  const addRule = useCallback(async (rule) => {
    if (!isFirebaseConfigured) return null;
    await insertRow('fee_rules', {
      key:   String(rule.key || '').trim(),
      label: String(rule.label || '').trim(),
      basis: rule.basis === 'profit' ? 'profit' : 'revenue',
      rate:  Math.max(0, Number(rule.rate) || 0),
      effective_from: rule.effectiveFrom || null,
      active: true,
    });
    await refetch();
  }, [refetch]);

  const updateRule = useCallback(async (id, patch) => {
    if (!isFirebaseConfigured) return null;
    const payload = {};
    if (patch.label !== undefined) payload.label = patch.label;
    if (patch.basis !== undefined) payload.basis = patch.basis === 'profit' ? 'profit' : 'revenue';
    if (patch.rate  !== undefined) payload.rate  = Math.max(0, Number(patch.rate) || 0);
    if (patch.effectiveFrom !== undefined) payload.effective_from = patch.effectiveFrom || null;
    if (patch.active !== undefined) payload.active = Boolean(patch.active);
    await updateRow('fee_rules', id, payload);
    await refetch();
  }, [refetch]);

  const deleteRule = useCallback(async (id) => {
    if (!isFirebaseConfigured) return null;
    await deleteRow('fee_rules', id);
    await refetch();
  }, [refetch]);

  return { rules, loading, error, addRule, updateRule, deleteRule, refetch };
}
