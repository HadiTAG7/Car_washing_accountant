/**
 * الاعتراف بالإيراد — «معتمد» ليست «نُفِّذت»، والمجهول لا يُسقَط
 * ═══════════════════════════════════════════════════════════════════════════
 * الادعاء الحامل: **حالةٌ غير نهائية لا تُنتج إيراداً**، وحالةٌ لا تصنّفها
 * السياسة **لا تُستبعد بصمت** بل تُعرض. الاستبعاد الصامت أخطر من الخطأ
 * الصريح: الإيراد ينقص ولا شيء يشي بذلك.
 *
 * Run: npm run test:functions
 */
import { describe, it, expect } from 'vitest';
import { recognitionFor, coverageProblems, RECOGNITION_POLICY_SEED } from '../src/sweater/recognition.js';

const POLICY = [{ ...RECOGNITION_POLICY_SEED, effectiveFrom: '2026-01-01', status: 'active' }];
const at = (status, extra = {}) => ({ normalizedStatus: status, rawStatus: status, ...extra });

describe('recognitionFor', () => {
  it('الحالة النهائية وحدها مؤهّلة', () => {
    expect(recognitionFor(at('payment_collection'), POLICY, '2026-05-20'))
      .toMatchObject({ eligibility: 'eligible', reasonCode: 'final_status' });
  });

  it('و«معتمدة» ليست كافية — الحجز معتمدٌ لا الخدمة منفَّذة', () => {
    // الادعاء الحامل: هذا بالضبط ما يُثبت إيراداً لخدمةٍ لم تُقدَّم.
    const r = recognitionFor(at('approved'), POLICY, '2026-05-20');
    expect(r.eligibility).toBe('needs_review');
    expect(r.reasonCode).toBe('not_final_status');
  });

  it('و«بدأ الغسيل» ليست كافية — العمل بدأ ولم ينتهِ', () => {
    expect(recognitionFor(at('washing_started'), POLICY, '2026-05-20').eligibility)
      .toBe('needs_review');
  });

  it('والملغى إدارياً مستبعدٌ صراحةً — لا مراجعة له ولا إيراد', () => {
    expect(recognitionFor(at('admin_cancelled'), POLICY, '2026-05-20'))
      .toMatchObject({ eligibility: 'not_eligible', reasonCode: 'excluded_status' });
  });

  it('وحالةٌ مجهولة تذهب للمراجعة وتذكر نصّها الخام — لا تُسقَط', () => {
    const r = recognitionFor(
      { normalizedStatus: 'unknown', rawStatus: 'قيد التسليم النهائي' }, POLICY, '2026-05-20',
    );
    expect(r).toMatchObject({ eligibility: 'needs_review', reasonCode: 'unknown_status' });
    expect(r.reasonAr).toContain('قيد التسليم النهائي');
  });

  it('وتاريخٌ قبل أول سياسة لا يُعترف بإيراده', () => {
    const r = recognitionFor(at('payment_collection'), POLICY, '2025-12-31');
    expect(r).toMatchObject({ eligibility: 'needs_review', reasonCode: 'no_recognition_policy' });
    expect(r.reasonAr).toContain('2026-01-01');
  });

  it('والسياسة مؤرخة: توسيعُها لاحقاً لا يعيد تصنيف ما قبله', () => {
    // من يونيو تصير «بدأ الغسيل» كافية — ومايو يبقى كما كان.
    const rows = [
      ...POLICY,
      { key: 'default', effectiveFrom: '2026-06-01', status: 'active',
        eligibleStatuses: ['payment_collection', 'washing_started'], excludedStatuses: ['admin_cancelled'] },
    ];
    expect(recognitionFor(at('washing_started'), rows, '2026-05-20').eligibility).toBe('needs_review');
    expect(recognitionFor(at('washing_started'), rows, '2026-06-20').eligibility).toBe('eligible');
  });

  it('وشرط تسجيل الدفع يُحترم حين تفرضه السياسة', () => {
    const rows = [{ ...RECOGNITION_POLICY_SEED, effectiveFrom: '2026-01-01', status: 'active',
      requirePaymentRecorded: true }];
    expect(recognitionFor(at('payment_collection', { paymentStatus: 'pending' }), rows, '2026-05-20'))
      .toMatchObject({ eligibility: 'needs_review', reasonCode: 'payment_not_recorded' });
    expect(recognitionFor(at('payment_collection', { paymentStatus: 'recorded' }), rows, '2026-05-20').eligibility)
      .toBe('eligible');
  });

  it('وكل قرار يحمل سببه — رقمٌ مستبعَد بلا سبب لا يُدافَع عنه', () => {
    for (const s of ['payment_collection', 'approved', 'admin_cancelled', 'unknown']) {
      const r = recognitionFor(at(s), POLICY, '2026-05-20');
      expect(r.reasonCode).toBeTruthy();
      expect(r.reasonAr).toBeTruthy();
    }
  });
});

describe('coverageProblems — استيرادٌ ناقص ليس استيراداً', () => {
  it('تغطيةٌ كاملة بلا مشاكل', () => {
    expect(coverageProblems({
      rangeFrom: '2026-05-01', rangeTo: '2026-05-31', pageCount: 4, pagesFetched: 4, isComplete: true,
    })).toEqual([]);
  });

  it('وصفحةٌ مفقودة تُقال بعددها', () => {
    const p = coverageProblems({ rangeFrom: '2026-05-01', rangeTo: '2026-05-31', pageCount: 5, pagesFetched: 3 });
    expect(p.some((x) => x.includes('فُقدت 2'))).toBe(true);
  });

  it('وإقرار الوكيل بالنقص يُصدَّق', () => {
    expect(coverageProblems({ rangeFrom: '2026-05-01', rangeTo: '2026-05-31', isComplete: false }))
      .not.toEqual([]);
  });

  it('ونطاقٌ مقلوب أو غائب يُرفض', () => {
    expect(coverageProblems({})).not.toEqual([]);
    expect(coverageProblems({ rangeFrom: '2026-05-31', rangeTo: '2026-05-01' })
      .some((x) => x.includes('قبل بدايته'))).toBe(true);
  });
});
