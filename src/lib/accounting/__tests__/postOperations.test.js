import { describe, it, expect } from 'vitest';
import { hasPostedEntryFor } from '../firestoreLedger';
import { canPostWash, expenseAccountFor } from '../postingRules';
import { isPeriodClosed, indexPeriods } from '../periods';
import { periodKeyOf } from '../journal';

/**
 * The posting sweep itself talks to Firestore, but the decisions it makes are
 * pure. These cover the predicates that decide whether a record posts —
 * idempotency above all, since re-running the sweep must never double-post.
 */

describe('عدم التكرار عند إعادة الترحيل', () => {
  const entries = [
    { sourceType: 'wash', sourceId: 'w1', status: 'posted' },
    { sourceType: 'wash', sourceId: 'w2', status: 'draft' },
    { sourceType: 'expense', sourceId: 'e1', status: 'reversed' },
  ];

  it('يتجاوز عملية لها قيد مُرحّل', () => {
    expect(hasPostedEntryFor(entries, 'wash', 'w1')).toBe(true);
  });

  it('يعيد ترحيل عملية قيدها مسودة فقط', () => {
    expect(hasPostedEntryFor(entries, 'wash', 'w2')).toBe(false);
  });

  it('يسمح بإعادة ترحيل عملية عُكس قيدها', () => {
    // A reversed entry means the books no longer carry it — the record is
    // eligible again, which is what makes "reverse then re-post" work.
    expect(hasPostedEntryFor(entries, 'expense', 'e1')).toBe(false);
  });

  it('لا يخلط بين مصدرين لهما نفس المعرّف', () => {
    // A wash and an expense could share an id across collections.
    expect(hasPostedEntryFor(entries, 'expense', 'w1')).toBe(false);
  });

  it('يتعامل مع قائمة فارغة', () => {
    expect(hasPostedEntryFor([], 'wash', 'w1')).toBe(false);
    expect(hasPostedEntryFor(undefined, 'wash', 'w1')).toBe(false);
  });
});

describe('أهلية العملية للترحيل', () => {
  it('الغسلة غير المكتملة لا تُرحّل — لا إيراد قبل الإنجاز', () => {
    expect(canPostWash({ status: 'قيد التنفيذ' })).toBe(false);
    expect(canPostWash({ status: 'مكتملة' })).toBe(true);
    expect(canPostWash({})).toBe(false);
  });

  it('السجل بلا تاريخ صالح لا يُرحّل', () => {
    expect(periodKeyOf('')).toBe('');
    expect(periodKeyOf(null)).toBe('');
    expect(periodKeyOf('2026-08-11')).toBe('2026-08');
  });

  it('السجل في فترة مقفلة لا يُرحّل', () => {
    const idx = indexPeriods([
      { periodKey: '2026-07', status: 'closed' },
      { periodKey: '2026-08', status: 'open' },
    ]);
    expect(isPeriodClosed(periodKeyOf('2026-07-15'), idx)).toBe(true);
    expect(isPeriodClosed(periodKeyOf('2026-08-15'), idx)).toBe(false);
    // A month with no document at all is open — the ledger should not refuse
    // business just because nobody opened this month yet.
    expect(isPeriodClosed(periodKeyOf('2026-09-15'), idx)).toBe(false);
  });
});

describe('توجيه المصروف إلى حسابه', () => {
  it('كل نوع مصروف يذهب لحسابه الصحيح', () => {
    expect(expenseAccountFor('variable')).toBe('5100');
    expect(expenseAccountFor('monthly')).toBe('5200');
    expect(expenseAccountFor('annual')).toBe('5300');
    expect(expenseAccountFor('commission')).toBe('5000');
    expect(expenseAccountFor('depreciation')).toBe('5400');
  });

  it('رسوم التأسيس تُرسمَل أصلاً ثابتاً لا مصروفاً', () => {
    const acc = expenseAccountFor('startup');
    expect(acc).toBe('1500');
    expect(acc.startsWith('1')).toBe(true);   // asset range, not 5xxx
  });

  it('النوع غير المعروف يقع على المصروفات الإدارية', () => {
    expect(expenseAccountFor('whatever')).toBe('5300');
  });
});
