/**
 * قواعد تحويل مبلغ بند التأسيس إلى قيد.
 *
 * The parent has an amount and nothing else a journal entry needs: no spend
 * date, no payment method, no per-document identity. So the conversion asks
 * for exactly those, and refuses rather than filling any of them in — least
 * of all from `created_at`, which is the day the row was typed and not the
 * day the money moved.
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest';
import {
  legacyEntryIdFor, startupParentNeedsConversion, startupParentClaimsVat,
  startupConversionProblems, buildStartupConversionEntry, pendingStartupConversions,
} from '../startupMigration';

const PARENT = (over = {}) => ({
  id: 'p1', itemName: 'ماكينة ضغط', plannedAmount: 1000, actualAmount: 1150,
  isTaxInvoice: true, invoiceUrl: '', createdAt: '2026-08-20T09:00:00.000Z', ...over,
});
const FORM = (over = {}) => ({
  spentDate: '2026-03-12', paymentMethod: 'cash',
  isTaxInvoice: true, invoiceNumber: 'S-77', invoiceDate: '2026-03-10',
  supplier: 'مؤسسة النور', vatAmount: 150, vatRate: null,
  priceMode: 'inclusive', vatDeductible: true, ...over,
});

describe('أي بند يحتاج تحويلاً', () => {
  it('البند ذو المبلغ الفعلي بلا قيود فرعية', () => {
    expect(startupParentNeedsConversion(PARENT())).toBe(true);
    expect(startupParentClaimsVat(PARENT())).toBe(true);
  });

  it('ولا يحتاجه بند له قيود — مبلغه صار مجموعها', () => {
    expect(startupParentNeedsConversion(PARENT(), { hasEntries: true })).toBe(false);
    expect(startupParentClaimsVat(PARENT(), { hasEntries: true })).toBe(false);
  });

  it('ولا بند بلا مبلغ فعلي — الخطة وحدها ليست صرفاً', () => {
    expect(startupParentNeedsConversion(PARENT({ actualAmount: 0 }))).toBe(false);
  });

  it('والقائمة تستبعد ما صار مُداراً بالسجل', () => {
    const items = [PARENT(), PARENT({ id: 'p2', itemName: 'رفّاعة', isTaxInvoice: false })];
    expect(pendingStartupConversions(items, new Set(['p2'])).map((x) => x.id)).toEqual(['p1']);
    expect(pendingStartupConversions(items, new Set()).map((x) => x.claimsVat)).toEqual([true, false]);
  });
});

describe('ما يجب على المستخدم إدخاله', () => {
  it('لا يقبل تحويلاً بلا تاريخ صرف — ولا يملأه من created_at', () => {
    const problems = startupConversionProblems(PARENT(), FORM({ spentDate: '' }));
    expect(problems.join(' ')).toMatch(/تاريخ الصرف/);
    // The only date the record holds is the day it was typed, and it is not
    // offered as a substitute anywhere.
    expect(problems.join(' ')).not.toMatch(/2026-08-20/);
  });

  it('ويرفض تاريخاً غير موجود في التقويم', () => {
    expect(startupConversionProblems(PARENT(), FORM({ spentDate: '2026-02-30' })).join(' '))
      .toMatch(/تاريخ الصرف/);
  });

  it('ويطلب طريقة الدفع', () => {
    expect(startupConversionProblems(PARENT(), FORM({ paymentMethod: '' })).join(' '))
      .toMatch(/طريقة الدفع/);
  });

  it('ويطلب هوية الفاتورة كاملة حين تكون فاتورة ضريبية', () => {
    for (const gap of [{ invoiceNumber: '' }, { invoiceDate: '' }, { supplier: '' }]) {
      expect(startupConversionProblems(PARENT(), FORM(gap))).not.toEqual([]);
    }
    // …ولا يطلبها إن لم تكن كذلك.
    expect(startupConversionProblems(PARENT(), FORM({
      isTaxInvoice: false, invoiceNumber: '', invoiceDate: '', supplier: '', vatAmount: null,
    }))).toEqual([]);
  });

  it('ويطبّق نفس فحص حقول الضريبة الذي تطبّقه النماذج', () => {
    expect(startupConversionProblems(PARENT(), FORM({ vatAmount: -5 })).join(' ')).toMatch(/سالب/);
    expect(startupConversionProblems(PARENT(), FORM({ vatAmount: 5000 })).join(' '))
      .toMatch(/أكبر من إجمالي الفاتورة/);
  });

  it('ويرفض بنداً بلا مبلغ فعلي أو بنداً له قيود بالفعل', () => {
    expect(startupConversionProblems(PARENT({ actualAmount: 0 }), FORM()).join(' '))
      .toMatch(/لا يوجد مبلغ فعلي/);
    expect(startupConversionProblems(PARENT(), FORM(), { hasEntries: true }).join(' '))
      .toMatch(/سجل مصاريف بالفعل/);
  });

  it('ويرفض التحويل إلى فترة مقفلة — بتاريخ الصرف أو بتاريخ الفاتورة', () => {
    expect(startupConversionProblems(PARENT(), FORM(), { closedPeriods: new Set(['2026-03']) }).join(' '))
      .toMatch(/الفترة 2026-03 مقفلة/);
    expect(startupConversionProblems(PARENT(), FORM({ spentDate: '2026-04-02' }), {
      closedPeriods: new Set(['2026-03']),
    }).join(' ')).toMatch(/الفترة 2026-03 مقفلة/);
    expect(startupConversionProblems(PARENT(), FORM(), { closedPeriods: new Set(['2026-09']) }))
      .toEqual([]);
  });
});

describe('القيد الناتج', () => {
  it('يأخذ مبلغ البند وتواريخ المستخدم، ومعرّفه مشتق من البند', () => {
    const entry = buildStartupConversionEntry(PARENT(), FORM());
    expect(entry).toMatchObject({
      id: 'legacy__p1', startupCostId: 'p1', amount: 1150,
      spentDate: '2026-03-12', invoiceDate: '2026-03-10',
      invoiceNumber: 'S-77', supplier: 'مؤسسة النور',
      vatAmount: 150, priceMode: 'inclusive', paymentMethod: 'cash',
    });
    expect(legacyEntryIdFor('p1')).toBe('legacy__p1');
  });

  it('ولا يحمل createdAt في أي حقل تاريخ', () => {
    const entry = buildStartupConversionEntry(PARENT(), FORM());
    expect(entry.spentDate).not.toContain('2026-08');
    expect(entry.invoiceDate).not.toContain('2026-08');
    expect(JSON.stringify(entry)).not.toContain('2026-08-20');
  });
});
