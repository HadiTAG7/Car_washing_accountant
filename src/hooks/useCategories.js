import { useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { CATEGORIES } from '../data/initialData';
import { useSupabaseQuery } from './useSupabaseQuery';

const FALLBACK = CATEGORIES.map((c, i) => ({ ...c, sortOrder: i }));

function mapCategory(row) {
  return {
    id:        row.id,
    label:     row.label,
    sortOrder: row.sort_order ?? 0,
  };
}

export function useCategories() {
  const { data, loading, error, refetch } = useSupabaseQuery(
    () => supabase.from('categories').select('*').order('sort_order'),
    {
      enabled: isSupabaseConfigured,
      map:     mapCategory,
      fallback: FALLBACK,
    },
  );

  const categories = isSupabaseConfigured ? (data ?? []) : (data || FALLBACK);

  const addCategory = useCallback(async ({ id, label }) => {
    if (!isSupabaseConfigured) return null;
    const maxOrder = categories.reduce((m, c) => Math.max(m, c.sortOrder), 0);
    const { error: err } = await supabase
      .from('categories')
      .insert({ id, label, sort_order: maxOrder + 1 });
    if (err) throw err;
    await refetch();
  }, [refetch, categories]);

  const updateCategory = useCallback(async (id, label) => {
    if (!isSupabaseConfigured) return null;
    const { error: err } = await supabase
      .from('categories')
      .update({ label })
      .eq('id', id);
    if (err) throw err;
    await refetch();
  }, [refetch]);

  const deleteCategory = useCallback(async (id) => {
    if (!isSupabaseConfigured) return null;
    const { error: err } = await supabase
      .from('categories')
      .delete()
      .eq('id', id);
    if (err) throw err;
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
