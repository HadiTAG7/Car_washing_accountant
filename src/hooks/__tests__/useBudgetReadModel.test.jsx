// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useBudgetReadModel } from '../useBudgetReadModel';
afterEach(cleanup);
it('retains category-only discovery, one-time dates, recurring amounts, hidden virtuals and partner scaling unchanged', () => {
  const input = { budgets: [{ id: 'B', categoryLabel: 'Rent', budgetType: 'monthly', amount: 200 }],
    monthlies: [{ categoryId: 'rent', expenseName: 'Must not become a category', totalMonthlyCost: 100, recurrence: 'recurring' },
      { categoryId: 'rent', totalMonthlyCost: 30, recurrence: 'one_time', loggedDate: '2026-09-10' },
      { categoryId: 'rent', totalMonthlyCost: 20, recurrence: 'one_time', loggedDate: '2026-10-10' }],
    monthlyCats: [{ id: 'rent', label: 'Rent' }], annuals: [{ category: 'insurance', annualCost: 120 }], annualCats: [{ id: 'insurance', label: 'Insurance' }],
    variables: [{ categoryId: 'fuel', totalVariableCost: 15, loggedDate: '2026-10-01' }], variableCats: [{ id: 'fuel', label: 'Fuel' }],
    washes: [], hiddenKeys: new Set(['monthly::fuel']), currentMonth: '2026-10', currentYear: '2026', scalingFactor: 1 };
  const frozen = JSON.stringify(input);
  const { result, rerender } = renderHook(props => useBudgetReadModel(props), { initialProps: input });
  expect(result.current.cards.map(c => c.budget.categoryLabel)).toEqual(['Rent', 'Insurance']);
  expect(result.current.cards[0].spent).toBe(120); expect(result.current.cards[1].spent).toBe(120);
  expect(result.current.totals).toEqual({ allocated: 200, spent: 240, remaining: -40 });
  expect(result.current.suggestions).not.toContain('Must not become a category');
  rerender({ ...input, scalingFactor: .5 }); expect(result.current.totals).toEqual({ allocated: 100, spent: 120, remaining: -20 });
  expect(JSON.stringify(input)).toBe(frozen);
});
