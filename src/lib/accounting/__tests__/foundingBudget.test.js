import { describe, expect, it } from 'vitest';
import { foundingBudgetStatus } from '../foundingBudget.js';

const accounts = [
  { code: '5010', accountType: 'expense' },
  { code: '5100', accountType: 'expense' },
  { code: '5400', accountType: 'expense' },
  { code: '1500', accountType: 'asset' },
];

function posting(id, date, accountId, amount, sourceKind = 'monthly') {
  return {
    entry: { id, entryDate: date, status: 'posted', sourceKind },
    line: { id: `l-${id}`, entryId: id, accountId, debit: amount, credit: 0 },
  };
}

function status(rows, periodKey) {
  return foundingBudgetStatus({
    accounts,
    entries: rows.map((row) => row.entry),
    lines: rows.map((row) => row.line),
    periodKey,
  });
}

describe('سقف تمويل مرحلة التأسيس للشركاء', () => {
  it('يجمع التكاليف التشغيلية وأصول التأسيس دون أن يحمّل شريكاً خسارة قبل المليون', () => {
    const rows = [
      posting('asset', '2026-07-04', '1500', 600000, 'startup'),
      posting('salary', '2026-08-04', '5010', 100000),
      posting('variable', '2026-08-05', '5100', 50000, 'variable'),
    ];
    expect(status(rows, '2026-08')).toMatchObject({
      recordedCost: 750000, remaining: 250000, gateClosed: true,
    });
  });

  it('بلوغ المليون في شهر لا يفتح تحميل نتائجه بأثر رجعي؛ يبدأ من الشهر التالي', () => {
    const rows = [
      posting('asset', '2026-07-04', '1500', 900000, 'startup'),
      posting('salary', '2026-08-04', '5010', 100000),
    ];
    expect(status(rows, '2026-08').gateClosed).toBe(true);
    expect(status(rows, '2026-09')).toMatchObject({ recordedCost: 1000000, gateClosed: false });
  });

  it('لا يكرر احتساب الإهلاك أو أصل غير تأسيسي، ويخصم عكس القيد', () => {
    const rows = [
      posting('asset', '2026-07-04', '1500', 600000, 'startup'),
      posting('other-asset', '2026-07-04', '1500', 200000, 'asset'),
      posting('depreciation', '2026-08-04', '5400', 20000, 'depreciation'),
      posting('salary', '2026-08-05', '5010', 100000),
    ];
    rows.push({
      entry: { id: 'reverse', entryDate: '2026-08-06', status: 'posted', reversalOf: 'salary', reversedSourceKind: 'monthly' },
      line: { id: 'l-reverse', entryId: 'reverse', accountId: '5010', debit: 0, credit: 100000 },
    });
    expect(status(rows, '2026-08')).toMatchObject({ recordedCost: 600000, remaining: 400000 });
  });

  it('لا يدعي صفراً متحققاً عندما لا يتوفر دليل الحسابات', () => {
    expect(foundingBudgetStatus({ accounts: [], entries: [], lines: [], periodKey: '2026-08' }))
      .toMatchObject({ available: false, recordedCost: null, gateClosed: null });
  });
});
