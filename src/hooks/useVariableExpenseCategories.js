import { useCallback, useMemo } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { VARIABLE_EXPENSE_CATEGORIES } from '../data/initialData';
import { mapVariableExpenseCategory } from '../lib/mappers';
import { useSupabaseQuery } from './useSupabaseQuery';

const FALLBACK = VARIABLE_EXPENSE_CATEGORIES.map((c, i) => ({ ...c, sortOrder: i + 1 }));

export function useVariableExpenseCategories() {
  const { data, loading, error, refetch } = useSupabaseQuery(
    () => supabase
      .from('variable_expense_categories')
      // Explicit column list — never `select('*')`.
      .select('id, label, sort_order, is_dynamic')
      .order('sort_order'),
    {
      enabled: isSupabaseConfigured,
      map:     mapVariableExpenseCategory,
      fallback: FALLBACK,
    },
  );

  const categories = useMemo(
    () => (isSupabaseConfigured ? (data ?? []) : (data || FALLBACK)),
    [data],
  );

  const addCategory = useCallback(async ({ label }) => {
    if (!isSupabaseConfigured) throw new Error('Supabase غير مهيأ');
    const trimmed = String(label || '').trim();
    if (!trimmed) throw new Error('اسم التصنيف مطلوب');

    const existing = categories.find(
      (c) => String(c.label || '').trim().toLowerCase() === trimmed.toLowerCase(),
    );
    if (existing) return existing.id;

    const maxOrder = categories.reduce((m, c) => Math.max(m, c.sortOrder || 0), 0);
    const payload = { label: trimmed, sort_order: maxOrder + 1 };
    console.info('[variable_expense_categories] inserting payload:', payload);
    const { data: inserted, error: err } = await supabase
      .from('variable_expense_categories')
      .insert(payload)
      .select()
      .single();
    if (err) {
      console.error('Supabase Category Error:', err, 'payload:', payload);
      throw err;
    }
    console.info('[variable_expense_categories] inserted:', inserted);
    await refetch();
    return inserted?.id;
  }, [refetch, categories]);

  const getCategoryLabel = useCallback((id) => {
    if (!id) return 'بدون تصنيف';
    const found = categories.find((c) => c.id === id);
    return found ? found.label : 'بدون تصنيف';
  }, [categories]);

  const deleteCategory = useCallback(async (id) => {
    if (!isSupabaseConfigured) throw new Error('Supabase غير مهيأ');
    if (!id) return;
    const { error: err } = await supabase
      .from('variable_expense_categories')
      .delete()
      .eq('id', id);
    if (err) {
      console.error('Supabase Category Delete Error:', err);
      throw err;
    }
    await refetch();
  }, [refetch]);

  return { categories, loading, error, addCategory, deleteCategory, getCategoryLabel, refetch };
}
