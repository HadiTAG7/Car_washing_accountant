import { useCallback } from 'react';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { fetchRows, getRow, insertRow, updateRow, deleteRow, sortBy } from '../lib/firestoreCrud';
import { budgetHasRecordedExpenses } from '../lib/budgetControls';
import {
  mapBudget,
  toBudgetInsert,
  toBudgetUpdate,
  mapMonthlyExpense, mapVariableExpense, mapAnnualExpense, mapWash,
} from '../lib/mappers';
import { useFirestoreQuery } from './useFirestoreQuery';

export function useBudgets() {
  const { data, loading, error, refetch } = useFirestoreQuery(
    async () => sortBy(await fetchRows('category_budgets'), [{ key: 'category_label' }]),
    {
      cacheKey: 'category_budgets',
      enabled: isFirebaseConfigured,
      map:     mapBudget,
    },
  );

  const addItem = useCallback(async (item) => {
    if (!isFirebaseConfigured) return null;
    await insertRow('category_budgets', toBudgetInsert(item));
    await refetch();
  }, [refetch]);

  const updateItem = useCallback(async (id, updates) => {
    if (!isFirebaseConfigured) return null;
    const payload = toBudgetUpdate(updates);
    if (Object.keys(payload).length === 0) return null;
    await updateRow('category_budgets', id, payload);
    await refetch();
  }, [refetch]);

  const deleteItem = useCallback(async (id) => {
    if (!isFirebaseConfigured) return null;
    // Re-read before deleting: an expense added after the card loaded still blocks deletion.
    // A failed read fails closed. No category or expense is deleted here.
    const [budget,monthlies,monthlyCats,annuals,annualCats,variables,variableCats,washes] = await Promise.all([
      getRow('category_budgets',id), fetchRows('monthly_expenses'), fetchRows('monthly_expense_categories'),
      fetchRows('annual_expenses'), fetchRows('annual_expense_categories'), fetchRows('variable_expenses'),
      fetchRows('variable_expense_categories'), fetchRows('washes'),
    ]);
    if(!budget)throw new Error('الميزانية غير موجودة؛ لم يُنفّذ الحذف');
    if(budgetHasRecordedExpenses(mapBudget(budget),{monthlies:monthlies.map(mapMonthlyExpense),monthlyCats,
      annuals:annuals.map(mapAnnualExpense),annualCats,variables:variables.map(mapVariableExpense),
      variableCats:variableCats.map(c=>({...c,isDynamic:c.is_dynamic})),washes:washes.map(mapWash)})) {
      throw new Error('لا يمكن حذف ميزانية تصنيف عليه مصاريف مسجلة');
    }
    await deleteRow('category_budgets', id);
    await refetch();
  }, [refetch]);

  const items = data ?? [];
  return { items, loading, error, addItem, updateItem, deleteItem, refetch };
}
