import { describe, expect, it } from 'vitest';
import { documentAge, documentDay, filterWorkbenchItems, hasPaymentConflict, suggestedPaymentMethod, sumWorkbenchItems, workbenchCounters } from '../financeWorkbenchView';

describe('workbench read-only presentation', () => {
  it.each(['تحويل', 'مدى', 'بنكي', 'تَحويل بَنكي'])('warns about cash versus %s without editing the source', word => {
    const row = Object.freeze({ description: `فاتورة ${word}`, payment_method: 'cash' });
    expect(hasPaymentConflict(row)).toBe(true); expect(row.payment_method).toBe('cash');
    expect(hasPaymentConflict({ ...row, payment_method: 'transfer' })).toBe(false);
    expect(hasPaymentConflict({ receipt_type: word, payment_method: 'cash' })).toBe(true);
  });
  it('does not fabricate a conflict or a payment method for missing or ambiguous evidence', () => {
    expect(hasPaymentConflict({ description: 'شراء معدات', payment_method: 'cash' })).toBe(false);
    expect(hasPaymentConflict({ description: 'تحويل', payment_method: 'unknown' })).toBe(false);
    expect(suggestedPaymentMethod('', 'تحويل بنكي')).toBe('transfer');
    expect(suggestedPaymentMethod('دفع مدى')).toBe('card');
    expect(suggestedPaymentMethod('تحويل أو مدى')).toBeNull(); expect(suggestedPaymentMethod('معدات')).toBeNull();
  });
  it('sorts by actual dates, keeps all records beyond 30, searches supplier/document and never loses undated sources', () => {
    const rows = Array.from({ length: 65 }, (_, i) => ({ kind: 'variable', sourceId: `${i}`, title: `مستند ${i}`, supplier: i === 5 ? 'مورد خاص' : '', documentNumber: `INV-${i}`, date: i < 40 ? '2026-5-1' : '2026-10-1', amount: 10.01, workflowStage: i < 40 ? 'incomplete' : 'ready' }));
    const result = filterWorkbenchItems([...rows, { sourceId: 'unknown', date: null }]);
    expect(result).toHaveLength(66); expect(result[0].date).toBe('2026-10-1'); expect(result.at(-1).sourceId).toBe('unknown');
    expect(filterWorkbenchItems(rows, { month: '2026-10', stage: 'ready' })).toHaveLength(25);
    expect(filterWorkbenchItems(rows, { search: 'مورد خاص' })).toHaveLength(1);
    expect(filterWorkbenchItems(rows, { search: 'INV-64' })[0].sourceId).toBe('64');
    expect(workbenchCounters(rows).incomplete).toMatchObject({ count: 40, amount: 400.4 });
    expect(sumWorkbenchItems([...rows, { amount: null }])).toMatchObject({ amount: null, missing: 1, knownAmount: 650.65 });
  });
  it('marks age from expense day only and rejects malformed dates', () => {
    expect(documentAge('2026-09-22', '2026-10-23')).toBe(31);
    expect(documentAge('2026-09-23', '2026-10-23')).toBe(30);
    expect(documentAge(null, '2026-10-23')).toBeNull();
    expect(documentDay('2026-2-30')).toBeNull(); expect(documentDay('2026-5-1')).toBe('2026-05-01');
  });
});
