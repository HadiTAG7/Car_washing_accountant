import { describe, expect, it } from 'vitest';
import { partnerCapitalJourney } from '../src/partnerCapitalJourney.js';

describe('تفاصيل رأس المال لا تخمّن صرفاً لتطابق رصيداً ناقصاً', () => {
  it('يكشف اختلاف نطاق مستند الصرف عن نطاق رصيد التقرير ولا يغير مبلغ المستند', () => {
    const report = partnerCapitalJourney({ factor: 0.2, through: '2026-09', receipts: [], plans: [], startupEntries: [],
      initialSpend: [{ id: 'source', month: '2026-08', date: '2026-08-01', description: 'الدباب', amount: 1000, kind: 'startup' }],
      statements: [{ periodKey: '2026-09', totalCosts: 0, annualReserve: 0,
        founding: { funded: 20000, budget: 20000, remaining: 20000, recordedCost: 0 }, expenseBreakdown: { groups: [] } }],
    });
    expect(report.initialItems[0].amount).toBe(1000);
    expect(report.initialTotal).toBe(1000);
    expect(report.complete).toBe(false);
    expect(report.warnings[0].amount).toBe(1000);
  });
});
