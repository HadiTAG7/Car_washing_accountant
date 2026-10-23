import { useMemo } from 'react';
import { buildBudgetControlModel, budgetLabelKey } from '../lib/budgetControls';

const HIDDEN_STORAGE_KEY='hidden_budget_categories';
export function readHidden() {
  if(typeof window==='undefined')return new Set();
  try {const rows=JSON.parse(window.localStorage.getItem(HIDDEN_STORAGE_KEY)||'[]');return new Set(Array.isArray(rows)?rows:[]);} catch {return new Set();}
}
export const hideKeyFor = budget => `${budget.budgetType}::${budgetLabelKey(budget.categoryLabel)}`;
export function useBudgetReadModel(input) {
  return useMemo(()=>buildBudgetControlModel(input),[input]);
}
