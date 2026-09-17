/**
 * الحدّ — القسمة بالنسبة، والمصفاة التي لا تُفلت اسماً
 * ═══════════════════════════════════════════════════════════════════════════
 * الادعاء الحامل بكلمات صاحب الطلب: «لو نسبته ١٠٪ وغسلنا ١٠٠ غسلة، يقول له
 * عشر غسلات». والادعاء الثاني: لا يخرج من هذه الطبقة اسمُ عاملٍ ولا معرّفُ
 * حسابٍ ولا شريكٌ آخر مهما نسيت أداةٌ.
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest';
import {
  shareOf, scaleMoney, scaleCount, shareLine, capitalOf, assertScoped,
  PartnerMcpScopeError, lastMonths, receiptsByMonth, rowsByAccount, FORBIDDEN_KEYS,
} from '../scope.js';
import { PER_WORKER_FEE } from '../../../src/data/initialData.js';

const PARTNERS = [
  { id: 'p1', partnerName: 'أحمد', workersCount: 1 },
  { id: 'p2', partnerName: 'سالم', workersCount: 9 },
];

describe('القسمة بالنسبة', () => {
  it('١ من ١٠ عمّال = ١٠٪ — و١٠٠ غسلة تصير ١٠', () => {
    const share = shareOf(PARTNERS, 'p1');
    expect(share).toMatchObject({ workersCount: 1, totalWorkers: 10, factor: 0.1, sharePercent: 10, hasShare: true });
    expect(scaleCount(100, share.factor)).toBe(10);
    expect(shareLine(10, 100)).toBe('10 من أصل 100 غسلة تعادل حصّتك');
  });

  it('والمبالغ تُقسم وتُقرَّب لهللتين', () => {
    expect(scaleMoney(1234.567, 0.1)).toBe(123.46);
    expect(scaleMoney(100, 0)).toBe(0);
  });

  it('عدٌّ لا ينقسم يُعرض بمنزلةٍ عشرية لا بتقريبٍ كاذب', () => {
    expect(scaleCount(25, 0.1)).toBe(2.5);
  });

  it('بلا عمالة: صفرٌ لا قسمةٌ على صفر', () => {
    expect(shareOf([], 'p1')).toMatchObject({ factor: 0, sharePercent: 0, hasShare: false });
    expect(shareOf([{ id: 'p1', workersCount: 0 }, { id: 'p2', workersCount: 5 }], 'p1'))
      .toMatchObject({ factor: 0, hasShare: false, totalWorkers: 5 });
  });

  it('وشريكٌ ليس في القائمة نسبته صفر', () => {
    expect(shareOf(PARTNERS, 'ghost').hasShare).toBe(false);
  });
});

describe('رأس المال', () => {
  it('المطلوب من الرسم لكل عامل، والمسدَّد من السندات لا من المخزَّن', () => {
    const cap = capitalOf({ workersCount: 2, paidAmount: 999999 }, [{ amount: 15000 }, { amount: 5000 }]);
    expect(cap.required).toBe(2 * PER_WORKER_FEE);
    expect(cap.paid).toBe(20000);
    expect(cap.remaining).toBe(2 * PER_WORKER_FEE - 20000);
    expect(cap.settled).toBe(false);
    expect(cap.receiptsCount).toBe(2);
  });

  it('مسدَّدٌ بالكامل حين يُغلَق المتبقّي — ولا يصير سالباً', () => {
    const cap = capitalOf({ workersCount: 1 }, [{ amount: PER_WORKER_FEE + 500 }]);
    expect(cap.remaining).toBe(0);
    expect(cap.settled).toBe(true);
  });

  it('التحصيل الشهري يُجمع على أشهرٍ مسمّاة، والباقي يُترك', () => {
    const months = lastMonths(3, new Date(2026, 7, 15));   // يونيو، يوليو، أغسطس
    expect(months).toEqual(['2026-06', '2026-07', '2026-08']);
    const by = receiptsByMonth([
      { paymentDate: '2026-07-01', amount: 100 }, { paymentDate: '2026-07-20', amount: 50 },
      { paymentDate: '2025-01-01', amount: 999 },
    ], months);
    expect(by).toEqual([{ month: '2026-06', amount: 0 }, { month: '2026-07', amount: 150 }, { month: '2026-08', amount: 0 }]);
  });
});

describe('المصفاة', () => {
  it('ترمي عند أول مفتاحٍ ممنوع — ولو كان عميقاً', () => {
    expect(() => assertScoped({ ok: 1, rows: [{ amount: 1, bikerName: 'أحمد' }] }))
      .toThrow(PartnerMcpScopeError);
    expect(() => assertScoped({ nested: { deeper: { user_id: 'x' } } })).toThrow(/user_id/);
    expect(() => assertScoped({ partners: [] })).toThrow(/partners/);
  });

  it('وتُعيد ما لا يخالف كما هو', () => {
    const payload = { sharePercent: 10, washes: { companyCount: 100, yourShareCount: 10 }, list: [1, 2] };
    expect(assertScoped(payload)).toBe(payload);
  });

  it('وتغطي ما يجب أن تغطيه', () => {
    for (const k of ['bikerName', 'biker_name', 'user_id', 'ownerUid', 'tokenHash', 'contact_number', 'email', 'salary']) {
      expect(FORBIDDEN_KEYS.has(k), k).toBe(true);
    }
  });

  it('صفوف الحساب: رمزٌ واسمٌ ومبلغ — والصفر يُحذف', () => {
    expect(rowsByAccount([
      { code: '5200', nameArabic: 'الإيجار', amount: 40, debit: 40, credit: 0, known: true },
      { code: '5300', nameArabic: 'x', amount: 0 },
    ])).toEqual([{ code: '5200', name: 'الإيجار', amount: 40 }]);
  });
});
