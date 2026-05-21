import { useCallback, useMemo } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { RECURRING_EXPENSE_CATEGORIES } from '../data/initialData';
import { useSupabaseQuery } from './useSupabaseQuery';

function mapRow(row) {
  return {
    id:        row.id,
    label:     row.label,
    sortOrder: row.sort_order ?? 0,
  };
}

const FALLBACK = RECURRING_EXPENSE_CATEGORIES.map((c, i) => ({ ...c, sortOrder: i + 1 }));

export function useAnnualExpenseCategories() {
  const { data, loading, error, refetch } = useSupabaseQuery(
    () => supabase.from('annual_expense_categories').select('*').order('sort_order'),
    {
      enabled: isSupabaseConfigured,
      map:     mapRow,
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

    // Reject duplicates by case-insensitive label match.
    const existing = categories.find(
      (c) => String(c.label || '').trim().toLowerCase() === trimmed.toLowerCase(),
    );
    if (existing) return existing.id;

    const maxOrder = categories.reduce((m, c) => Math.max(m, c.sortOrder || 0), 0);
    // Do NOT send `id` — let Supabase generate the UUID via the column's
    // default (gen_random_uuid). We `.select().single()` to grab the real
    // UUID it assigned so the caller can auto-select the new category.
    const payload = { label: trimmed, sort_order: maxOrder + 1 };
    console.info('[annual_expense_categories] inserting payload:', payload);
    const { data: inserted, error: err } = await supabase
      .from('annual_expense_categories')
      .insert(payload)
      .select()
      .single();
    if (err) {
      console.error('Supabase Category Error:', err, 'payload:', payload);
      throw err;
    }
    console.info('[annual_expense_categories] inserted:', inserted);
    await refetch();
    return inserted?.id;
  }, [refetch, categories]);

  const getCategoryLabel = useCallback((id) => {
    const found = categories.find((c) => c.id === id);
    return found ? found.label : id;
  }, [categories]);

  return { categories, loading, error, addCategory, getCategoryLabel, refetch };
}
