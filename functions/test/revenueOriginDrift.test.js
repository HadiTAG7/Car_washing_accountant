/**
 * قرار مصدر الإيراد لا ينجرف بين الخادم والشاشة
 * ═══════════════════════════════════════════════════════════════════════════
 * المنع خادميّ، والمعاينة تنسخه لتقول ما سيحدث. وأخطر انجرافٍ ممكن أن تقول
 * الشاشة «سيُرحَّل» فيرفضه الخادم — أو أسوأ: أن تقول «لن يُرحَّل» فيقبله.
 *
 * Run: npm run test:functions
 */
import { describe, it, expect } from 'vitest';
import {
  washPostabilityProblem as serverCheck, clampRevenueOrigin as serverClamp,
  REVENUE_ORIGIN as SERVER_ORIGINS, washLinkProblems, integrationPhase,
} from '../src/sweater/revenueOrigin.js';
import {
  washPostabilityProblem as clientCheck, clampRevenueOrigin as clientClamp,
  REVENUE_ORIGIN as CLIENT_ORIGINS, REVENUE_ORIGIN_AR,
} from '../../src/lib/sweater/revenueOriginClient.js';

const ROWS = [
  { revenue_origin: 'direct' },
  { revenue_origin: 'sweater' },
  { revenue_origin: 'other_b2b' },
  { revenue_origin: 'nonsense' },
  { revenueOrigin: 'sweater' },
  {},
  null,
];

describe('انجراف مصدر الإيراد', () => {
  it('نفس القائمة ونفس الترجمة لكل رمز', () => {
    expect([...SERVER_ORIGINS].sort()).toEqual([...CLIENT_ORIGINS].sort());
    for (const o of SERVER_ORIGINS) expect(REVENUE_ORIGIN_AR[o]).toBeTruthy();
  });

  it('ونفس القرار لكل صفّ — حرفياً', () => {
    for (const row of ROWS) {
      expect(clientCheck(row), JSON.stringify(row)).toBe(serverCheck(row));
      expect(clientClamp(row?.revenue_origin ?? row?.revenueOrigin))
        .toBe(serverClamp(row?.revenue_origin ?? row?.revenueOrigin));
    }
  });

  it('والغياب يعني «مباشر» — الغسلات القديمة سُبقت التكامل وهي فعلاً مباشرة', () => {
    // الافتراض يصف الواقع ولا يعيد كتابته: لو كان الغياب `sweater` لتوقّف
    // ترحيل كل غسلةٍ قديمة فجأة.
    expect(serverClamp(undefined)).toBe('direct');
    expect(serverCheck({})).toBeNull();
  });

  it('وغسلة سويتر تُمنع برسالةٍ تقول أين يُعترف بإيرادها', () => {
    const why = serverCheck({ revenue_origin: 'sweater' });
    expect(why).toContain('سويتر');
    expect(why).toContain('مرتين');
  });
});

describe('washLinkProblems — لا غسلة سويتر يتيمة', () => {
  it('غسلة سويتر بلا رقم حجز تُرفض', () => {
    expect(washLinkProblems({ revenueOrigin: 'sweater' })).toHaveLength(1);
    expect(washLinkProblems({ revenueOrigin: 'sweater', sspBookingId: 'B1' })).toEqual([]);
  });

  it('ورقم حجزٍ على غسلةٍ مباشرة يُرفض — المصدر يُوحَّد أولاً', () => {
    expect(washLinkProblems({ revenueOrigin: 'direct', sspBookingId: 'B1' })).toHaveLength(1);
  });
});

describe('integrationPhase — قبل التاريخ وبعده', () => {
  it('قبل تاريخ التشغيل: المحاسبة القائمة لا تُعاد كتابتها بأثرٍ رجعي', () => {
    expect(integrationPhase('2026-04-30', '2026-05-01').phase).toBe('pre_integration');
  });

  it('ومن التاريخ فصاعداً سويتر هي المصدر', () => {
    expect(integrationPhase('2026-05-01', '2026-05-01').phase).toBe('sweater_authoritative');
    expect(integrationPhase('2026-06-15', '2026-05-01').phase).toBe('sweater_authoritative');
  });

  it('وغياب التاريخ يُقال ولا يُفترض — «أيهما المصدر؟» بلا جواب', () => {
    const r = integrationPhase('2026-05-01', '');
    expect(r.known).toBe(false);
    expect(r.reasonAr).toContain('تاريخ تشغيل');
  });
});
