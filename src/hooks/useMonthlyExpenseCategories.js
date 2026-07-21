import { useCallback, useMemo } from 'react';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { fetchRows, insertRow, deleteRow, sortBy } from '../lib/firestoreCrud';
import { MONTHLY_EXPENSE_CATEGORIES } from '../data/initialData';
import { mapMonthlyExpenseCategory } from '../lib/mappers';
import { useFirestoreQuery } from './useFirestoreQuery';

const FALLBACK = MONTHLY_EXPENSE_CATEGORIES.map((c, i) => ({ ...c, sortOrder: i + 1 }));

export function useMonthlyExpenseCategories() {
  const { data, loading, error, refetch } = useFirestoreQuery(
    async () => sortBy(await fetchRows('monthly_expense_categories'), [{ key: 'sort_order' }]),
    {
      enabled: isFirebaseConfigured,
      map:     mapMonthlyExpenseCategory,
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
    const id = await insertRow('monthly_expense_categories', { label: trimmed, sort_order: maxOrder + 1 });
    await refetch();
    return id;
  }, [refetch, categories]);

  const getCategoryLabel = useCallback((id) => {
    if (!id) return 'بدون تصنيف';
    const found = categories.find((c) => c.id === id);
    return found ? found.label : 'بدون تصنيف';
  }, [categories]);

  const deleteCategory = useCallback(async (id) => {
    if (!isFirebaseConfigured) throw new Error('Firebase غير مهيأ');
    if (!id) return;
    await deleteRow('monthly_expense_categories', id);
    await refetch();
  }, [refetch]);

  return { categories, loading, error, addCategory, deleteCategory, getCategoryLabel, refetch };
}
