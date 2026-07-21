import { useCallback, useMemo } from 'react';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { fetchRows, insertRow, deleteRow, sortBy } from '../lib/firestoreCrud';
import { RECURRING_EXPENSE_CATEGORIES } from '../data/initialData';
import { useFirestoreQuery } from './useFirestoreQuery';

function mapRow(row) {
  return {
    id:        row.id,
    label:     row.label,
    sortOrder: row.sort_order ?? 0,
  };
}

const FALLBACK = RECURRING_EXPENSE_CATEGORIES.map((c, i) => ({ ...c, sortOrder: i + 1 }));

export function useAnnualExpenseCategories() {
  const { data, loading, error, refetch } = useFirestoreQuery(
    async () => sortBy(await fetchRows('annual_expense_categories'), [{ key: 'sort_order' }]),
    {
      enabled: isFirebaseConfigured,
      map:     mapRow,
      fallback: FALLBACK,
    },
  );

  const categories = useMemo(
    () => (isFirebaseConfigured ? (data ?? []) : (data || FALLBACK)),
    [data],
  );

  const addCategory = useCallback(async ({ label }) => {
    if (!isFirebaseConfigured) throw new Error('Firebase غير مهيأ');
    const trimmed = String(label || '').trim();
    if (!trimmed) throw new Error('اسم التصنيف مطلوب');

    const existing = categories.find(
      (c) => String(c.label || '').trim().toLowerCase() === trimmed.toLowerCase(),
    );
    if (existing) return existing.id;

    const maxOrder = categories.reduce((m, c) => Math.max(m, c.sortOrder || 0), 0);
    // Firestore assigns the id; insertRow returns it so the caller can
    // auto-select the new category.
    const id = await insertRow('annual_expense_categories', { label: trimmed, sort_order: maxOrder + 1 });
    await refetch();
    return id;
  }, [refetch, categories]);

  const getCategoryLabel = useCallback((id) => {
    const found = categories.find((c) => c.id === id);
    return found ? found.label : id;
  }, [categories]);

  const deleteCategory = useCallback(async (id) => {
    if (!isFirebaseConfigured) throw new Error('Firebase غير مهيأ');
    if (!id) return;
    await deleteRow('annual_expense_categories', id);
    await refetch();
  }, [refetch]);

  return { categories, loading, error, addCategory, deleteCategory, getCategoryLabel, refetch };
}
