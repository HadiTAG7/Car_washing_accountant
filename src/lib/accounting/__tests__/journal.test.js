import { describe, it, expect } from 'vitest';
import {
  round2, periodKeyOf, totalsOf, isBalanced, validateEntry,
  mutationBlockedReason, buildReversal, normalizeEntry,
} from '../journal';

const line = (accountId, debit, credit) => ({ accountId, debit, credit, description: '' });

describe('توازن القيد', () => {
  it('يقبل قيداً متوازناً', () => {
    const lines = [line('1010', 115, 0), line('4000', 0, 100), line('2100', 0, 15)];
    expect(isBalanced(lines)).toBe(true);
    expect(totalsOf(lines)).toEqual({ debit: 115, credit: 115 });
  });

  it('يرفض قيداً غير متوازن ويذكر الطرفين', () => {
    const problems = validateEntry(
      { entryDate: '2026-08-11', sourceType: 'manual', description: 'اختبار' },
      [line('1010', 100, 0), line('4000', 0, 90)],
    );
    expect(problems.join(' ')).toContain('غير متوازن');
    expect(problems.join(' ')).toContain('100.00');
    expect(problems.join(' ')).toContain('90.00');
  });

  it('يتسامح مع فروق التقريب دون الهللة', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point.
    expect(isBalanced([line('1010', 0.1 + 0.2, 0), line('4000', 0, 0.3)])).toBe(true);
  });
});

describe('قواعد السطر الواحد', () => {
  it('يمنع سطراً يحمل مديناً ودائناً معاً', () => {
    const problems = validateEntry(
      { entryDate: '2026-08-11', sourceType: 'manual', description: 'اختبار' },
      [line('1010', 50, 50), line('4000', 0, 0)],
    );
    expect(problems.join(' ')).toContain('مديناً ودائناً معاً');
  });

  it('يمنع سطراً بلا مبلغ', () => {
    const problems = validateEntry(
      { entryDate: '2026-08-11', sourceType: 'manual', description: 'اختبار' },
      [line('1010', 100, 0), line('4000', 0, 100), line('5100', 0, 0)],
    );
    expect(problems.join(' ')).toContain('يجب إدخال مبلغ');
  });

  it('يمنع المبالغ السالبة', () => {
    const problems = validateEntry(
      { entryDate: '2026-08-11', sourceType: 'manual', description: 'اختبار' },
      [line('1010', -100, 0), line('4000', 0, -100)],
    );
    expect(problems.join(' ')).toContain('سالب');
  });

  it('يمنع قيداً بسطر واحد', () => {
    const problems = validateEntry(
      { entryDate: '2026-08-11', sourceType: 'manual', description: 'اختبار' },
      [line('1010', 100, 0)],
    );
    expect(problems.join(' ')).toContain('سطرين على الأقل');
  });

  it('يرفض حساباً خارج دليل الحسابات عند تمرير القائمة', () => {
    const problems = validateEntry(
      { entryDate: '2026-08-11', sourceType: 'manual', description: 'اختبار' },
      [line('1010', 100, 0), line('9999', 0, 100)],
      { knownAccountCodes: new Set(['1010', '4000']) },
    );
    expect(problems.join(' ')).toContain('9999');
  });
});

describe('بيانات رأس القيد', () => {
  it('يرفض تاريخاً غير صالح', () => {
    const problems = validateEntry(
      { entryDate: '11/08/2026', sourceType: 'manual', description: 'اختبار' },
      [line('1010', 1, 0), line('4000', 0, 1)],
    );
    expect(problems.join(' ')).toContain('تاريخ القيد غير صالح');
  });

  it('يرفض فترة لا تطابق التاريخ', () => {
    const problems = validateEntry(
      { entryDate: '2026-08-11', periodKey: '2026-07', sourceType: 'manual', description: 'اختبار' },
      [line('1010', 1, 0), line('4000', 0, 1)],
    );
    expect(problems.join(' ')).toContain('لا تطابق تاريخ القيد');
  });

  it('يشتق الفترة من التاريخ', () => {
    expect(periodKeyOf('2026-08-11')).toBe('2026-08');
    expect(periodKeyOf('')).toBe('');
    expect(normalizeEntry(
      { entryDate: '2026-08-11', sourceType: 'manual', description: 'x' }, [],
    ).entry.periodKey).toBe('2026-08');
  });
});

describe('حماية القيد المرحّل', () => {
  it('يمنع تعديل أو حذف قيد مرحّل', () => {
    const posted = { id: 'e1', status: 'posted' };
    expect(mutationBlockedReason(posted, 'edit')).toContain('لا يمكن تعديل أو حذف');
    expect(mutationBlockedReason(posted, 'delete')).toContain('قيداً عكسياً');
  });

  it('يسمح بتعديل المسودة', () => {
    expect(mutationBlockedReason({ status: 'draft' }, 'edit')).toBeNull();
  });

  it('يمنع عكس قيد غير مرحّل، ويسمح بعكس المرحّل', () => {
    expect(mutationBlockedReason({ status: 'draft' }, 'reverse')).toContain('غير مُرحّل');
    expect(mutationBlockedReason({ status: 'posted' }, 'reverse')).toBeNull();
  });

  it('يمنع إعادة ترحيل قيد مرحّل', () => {
    expect(mutationBlockedReason({ status: 'posted' }, 'post')).toContain('مُرحّل بالفعل');
  });
});

describe('القيد العكسي', () => {
  const original = {
    id: 'e1', entryNumber: 12, entryDate: '2026-07-15', sourceType: 'wash',
    sourceId: 'w1', description: 'غسلة', status: 'posted',
  };
  const lines = [line('1010', 115, 0), line('4000', 0, 100), line('2100', 0, 15)];

  it('يقلب كل مدين إلى دائن والعكس', () => {
    const rev = buildReversal(original, lines, { entryDate: '2026-08-01' });
    expect(rev.lines).toEqual([
      expect.objectContaining({ accountId: '1010', debit: 0,   credit: 115 }),
      expect.objectContaining({ accountId: '4000', debit: 100, credit: 0 }),
      expect.objectContaining({ accountId: '2100', debit: 15,  credit: 0 }),
    ]);
  });

  it('ينتج قيداً متوازناً يلغي أثر الأصل تماماً', () => {
    const rev = buildReversal(original, lines, { entryDate: '2026-08-01' });
    expect(isBalanced(rev.lines)).toBe(true);
    // Net effect of original + reversal on every account is zero.
    const net = new Map();
    for (const l of [...lines, ...rev.lines]) {
      net.set(l.accountId, (net.get(l.accountId) || 0) + l.debit - l.credit);
    }
    for (const v of net.values()) expect(round2(v)).toBe(0);
  });

  it('يؤرَّخ في فترة مستقلة ويشير إلى الأصل', () => {
    const rev = buildReversal(original, lines, { entryDate: '2026-08-01' });
    expect(rev.entry.periodKey).toBe('2026-08');   // not the original's 2026-07
    expect(rev.entry.reversalOf).toBe('e1');
    expect(rev.entry.description).toContain('عكس قيد رقم 12');
  });
});

describe('التقريب', () => {
  it('يقرّب إلى هللتين', () => {
    expect(round2(8.216666)).toBe(8.22);
    expect(round2(1.005)).toBe(1.01);
    expect(round2(-0)).toBe(0);
  });
});
