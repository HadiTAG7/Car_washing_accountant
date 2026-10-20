import { describe, it, expect } from 'vitest';
import {
  RATIO_KEYS, assertNoRatio, projectAllocationReport, projectWashShare, projectPartnerProfile,
} from '../src/partnerProjection.js';

const fullReport = () => ({
  partnerId: 'p1', factor: 0.25, workersCount: 5, totalWorkers: 20,
  asOf: '2026-10-03T00:00:00Z', fundingAsOf: '2026-10-03', fundingBasis: 'paid-through-report-date',
  from: '2026-09-01', through: '2026-09-30', basis: 'partner-allocation',
  capital: { paid: 100, receiptsCount: 2, ledgerBalance: 100, ledgerAvailable: true, unposted: 0, secret: 'x' },
  capitalJourney: { version: 1, months: [{ periodKey: '2026-09', groups: [{ items: [{ amount: 5, rawAmount: 20 }] }] }] },
  statements: [{
    periodKey: '2026-09', netRevenue: 250, totalAllocation: 80,
    eligibility: { originalWorkers: 5, eligibleWorkers: 5, suspendedWorkers: 0, effectiveFrom: null, factor: 0.25 },
    expenseBreakdown: { groups: [{ items: [{ id: 'a', amount: 10, rawAmount: 40 }] }] },
    fees: [{ key: 'mgmt', rate: 0.1, amount: 25 }],
    founding: { budget: 100000, covered: 80 },
  }],
});

describe('إسقاط ردود الشريك', () => {
  it('تقرير التوزيع: لا نسبة ولا عمالة شركة على أي عمق، والأرقام المقسومة باقية', () => {
    const out = projectAllocationReport(fullReport());
    const json = JSON.stringify(out);
    for (const key of RATIO_KEYS) expect(json).not.toContain(`"${key}"`);
    expect(out).toMatchObject({ partnerId: 'p1', workersCount: 5, through: '2026-09-30' });
    expect(out.capital).toEqual({ paid: 100, receiptsCount: 2, ledgerBalance: 100, ledgerAvailable: true, unposted: 0 });
    expect(out.statements[0]).toMatchObject({ netRevenue: 250, totalAllocation: 80, founding: { budget: 100000 } });
    expect(out.statements[0].eligibility).toEqual({ originalWorkers: 5, eligibleWorkers: 5, suspendedWorkers: 0, effectiveFrom: null });
    // A fee rule's rate is company policy, not the partner's share.
    expect(out.statements[0].fees[0].rate).toBe(0.1);
    expect(out.capitalJourney.months[0].groups[0].items[0]).toEqual({ amount: 5 });
  });

  it('لا يغيّر الردّ الأصلي الذي يأخذه المدير', () => {
    const report = fullReport();
    projectAllocationReport(report);
    expect(report.factor).toBe(0.25);
    expect(report.statements[0].eligibility.factor).toBe(0.25);
  });

  it('حصّة الغسلات: ما يعادل حصّته وحده بلا عدد الشركة', () => {
    const out = projectWashShare({
      partnerId: 'p1', workersCount: 1, totalWorkers: 10, factor: 0.1, sharePercent: 10,
      eligibility: { originalWorkers: 1, eligibleWorkers: 1, suspendedWorkers: 0, effectiveFrom: null, factor: 0.1 },
      months: [{ month: '2026-08', companyCount: 100, shareCount: 10 }],
    });
    expect(out).toEqual({
      partnerId: 'p1', workersCount: 1,
      eligibility: { originalWorkers: 1, eligibleWorkers: 1, suspendedWorkers: 0, effectiveFrom: null },
      months: [{ month: '2026-08', shareCount: 10 }],
    });
  });

  it('ملف الشريك: الاسم والعمالة والحالة فقط', () => {
    const out = projectPartnerProfile({ id: 'p1', partner_name: 'أحمد', workers_count: '3', user_id: 'uid',
      contact_number: '0500', paid_amount: 999, percentage: 30 });
    expect(out).toEqual({ id: 'p1', partnerName: 'أحمد', workersCount: 3, status: 'active' });
  });

  it('حقلٌ جديد يحمل النسبة يصير خطأً لا تسريباً', () => {
    expect(() => assertNoRatio({ statements: [{ nested: { totalWorkers: 20 } }] }))
      .toThrow('$.statements[0].nested.totalWorkers');
    expect(assertNoRatio({ ok: [1, { amount: 2 }] })).toEqual({ ok: [1, { amount: 2 }] });
  });
});
