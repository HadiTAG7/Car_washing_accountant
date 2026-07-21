import { useCallback } from 'react';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { fetchRows, insertRow, updateRow, deleteRow, sortBy } from '../lib/firestoreCrud';
import { CATEGORIES } from '../data/initialData';
import { useFirestoreQuery } from './useFirestoreQuery';

const FALLBACK = CATEGORIES.map((c, i) => ({ ...c, sortOrder: i }));

function mapCategory(row) {
  return {
    id:        row.id,
    label:     row.label,
    sortOrder: row.sort_order ?? 0,
  };
}

export function useCategories() {
  const { data, loading, error, refetch } = useFirestoreQuery(
    async () => sortBy(await fetchRows('categories'), [{ key: 'sort_order' }]),
    {
      enabled: isFirebaseConfigured,
      map:     mapCategory,
      fallback: FALLBACK,
    },
  );

  const categories = isFirebaseConfigured ? (data ?? []) : (data || FALLBACK);

  const addCategory = useCallback(async ({ id, label }) => {
    if (!isFirebaseConfigured) return null;
    const maxOrder = categories.reduce((m, c) => Math.max(m, c.sortOrder), 0);
    // `categories.id` is an app-generated slug/UUID → pass it as the doc id.
    await insertRow('categories', { id, label, sort_order: maxOrder + 1 });
    await refetch();
  }, [refetch, categories]);

  const updateCategory = useCallback(async (id, label) => {
    if (!isFirebaseConfigured) return null;
    await updateRow('categories', id, { label });
    await refetch();
  }, [refetch]);

  const deleteCategory = useCallback(async (id) => {
    if (!isFirebaseConfigured) return null;
    await deleteRow('categories', id);
    await refetch();
  }, [refetch]);

  const getCategoryLabel = useCallback((catId) => {
    const found = categories.find((c) => c.id === catId);
    return found ? found.label : catId;
  }, [categories]);

  return {
    categories,
    loading,
    error,
    addCategory,
    updateCategory,
    deleteCategory,
    getCategoryLabel,
    refetch,
  };
}
