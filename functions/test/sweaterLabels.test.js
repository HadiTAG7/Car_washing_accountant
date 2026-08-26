/**
 * الرموز وأسماؤها لا تنجرفان — رمزٌ بلا ترجمة يسقط هنا لا في شاشة المستخدم
 * ═══════════════════════════════════════════════════════════════════════════
 * الخادم يخزّن رموزاً والواجهة تعرض عربية. والانجراف الوحيد الممكن بينهما هو
 * رمزٌ يُضاف ولا يُترجَم — فيظهر «payment_collection» في شاشةٍ عربية، أو
 * ترجمةٌ تبقى لرمزٍ حُذف فتوهم بوجود حالةٍ لا وجود لها.
 *
 * Run: npm run test:functions
 */
import { describe, it, expect } from 'vitest';
import {
  BOOKING_STATUS, PAYMENT_STATUS, BOOKING_KIND, RECOGNITION_ELIGIBILITY,
  PROCESSING_STATUS, SETTLEMENT_STATUS, AGENT_STATUS, ADJUSTMENT_KIND,
  ADJUSTMENT_APPROVAL, REVIEW_REASON, UNKNOWN_STATUS,
} from '../src/sweater/vocab.js';
import { BEARERS } from '../src/sweater/adjustmentTypes.js';
import {
  BOOKING_STATUS_AR, PAYMENT_STATUS_AR, BOOKING_KIND_AR,
  RECOGNITION_ELIGIBILITY_AR, PROCESSING_STATUS_AR, SETTLEMENT_STATUS_AR,
  AGENT_STATUS_AR, ADJUSTMENT_KIND_AR, ADJUSTMENT_APPROVAL_AR, BEARER_AR,
  REVIEW_REASON_AR, labelOf,
} from '../../src/lib/sweater/labels.js';

const CASES = [
  ['حالات الحجز', [...BOOKING_STATUS, UNKNOWN_STATUS], BOOKING_STATUS_AR],
  ['حالات الدفع', PAYMENT_STATUS, PAYMENT_STATUS_AR],
  ['نوع الحجز', BOOKING_KIND, BOOKING_KIND_AR],
  ['أهلية الاعتراف', RECOGNITION_ELIGIBILITY, RECOGNITION_ELIGIBILITY_AR],
  ['مراحل المعالجة', PROCESSING_STATUS, PROCESSING_STATUS_AR],
  ['حالات التسوية', SETTLEMENT_STATUS, SETTLEMENT_STATUS_AR],
  ['حال الوكيل', AGENT_STATUS, AGENT_STATUS_AR],
  ['أنواع التسوية', ADJUSTMENT_KIND, ADJUSTMENT_KIND_AR],
  ['مسار الاعتماد', ADJUSTMENT_APPROVAL, ADJUSTMENT_APPROVAL_AR],
  ['الجهة المتحمّلة', BEARERS, BEARER_AR],
  ['أسباب المراجعة', REVIEW_REASON, REVIEW_REASON_AR],
];

describe.each(CASES)('%s', (name, codes, dict) => {
  it('كل رمزٍ له اسمٌ عربي', () => {
    for (const code of codes) {
      expect(dict[code], `${name}: الرمز «${code}» بلا ترجمة`).toBeTruthy();
    }
  });

  it('ولا اسمٌ عربي بلا رمز — ترجمةٌ يتيمة تَعِد بحالةٍ لا وجود لها', () => {
    const known = new Set(codes);
    for (const key of Object.keys(dict)) {
      expect(known.has(key), `${name}: الترجمة «${key}» بلا رمز`).toBe(true);
    }
  });
});

describe('labelOf', () => {
  it('يعرض الرمز كما هو حين لا ترجمة — السطر لا يختفي', () => {
    expect(labelOf(BOOKING_STATUS_AR, 'brand_new_status')).toBe('brand_new_status');
    expect(labelOf(BOOKING_STATUS_AR, 'approved')).toBe('معتمدة');
    expect(labelOf(BOOKING_STATUS_AR, null, '—')).toBe('—');
  });
});
