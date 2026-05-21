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

// Build a stable text id from a label. Keeps Arabic chars, lowercases ASCII,
// replaces whitespace + punctuation with dashes, and appends a short random
// suffix to avoid collisions if the same label is added twice.
function slugifyLabel(label) {
  const base = String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[\s/\\]+/g, '-')
    .replace(/[^\w؀-ۿ-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const suffix = Math.random().toString(36).slice(2, 7);
  return base ? `${base}-${suffix}` : `cat-${suffix}`;
}

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

    const id = slugifyLabel(trimmed);
    const maxOrder = categories.reduce((m, c) => Math.max(m, c.sortOrder || 0), 0);
    const payload = { id, label: trimmed, sort_order: maxOrder + 1 };
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
    return id;
  }, [refetch, categories]);

  const getCategoryLabel = useCallback((id) => {
    const found = categories.find((c) => c.id === id);
    return found ? found.label : id;
  }, [categories]);

  return { categories, loading, error, addCategory, getCategoryLabel, refetch };
}
