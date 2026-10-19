import { operationsReportId } from '../../src/lib/operationsReportContract.js';
export function operationsFixture(overrides = {}) {
  const report = {
    schemaVersion: 1, reportId: '', revision: 1, dateRiyadh: '2026-10-18', serviceDateRiyadh: '2026-10-17',
    cutAtRiyadh: '2026-10-18T09:00:00+03:00', issuedAtRiyadh: '2026-10-18T09:05:00+03:00',
    sourceRole: 4, sourceLabel: 'مدير العمليات — اختبار اصطناعي', archiveMode: 'current', kind: 'morning_review', round: '0900', status: 'partial', snapshot: 'bounded',
    period: { from: '2026-10-17', to: '2026-10-17' }, title: 'تقرير عمليات اصطناعي — غير صالح كتقرير عمل', summary: 'اختبار حفظ اللقطة العربية وحدودها فقط.',
    review: { completed: true, reviewerRole: 4, sourceRef: 'SYNTHETIC-REVIEW', at: '2026-10-18T09:05:00+03:00' },
    activity: { read: { count: 3, detail: 'مقروء في الاختبار' }, previewed: { count: 2, detail: 'معاينة لا تثبت الحفظ' }, saved: { count: 0, detail: 'لا حفظ عمليات' }, blocked: { count: null, detail: 'غير متاح' } },
    coverage: { individual: { status: 'partial', detail: 'عينة اختبار فردية فقط' }, b2b: { status: 'unavailable', detail: 'تغطية الشركات غير متاحة في المصدر' } },
    metrics: [{ id: 'TEST', label: 'مؤشر غير متاح', value: null, unit: 'غسلة', basis: 'unavailable', coverage: 'لا يملأ بصفر', asOf: '2026-10-18T09:00:00+03:00' }],
    visibleWarnings: [{ id: 'TEST-WARNING', severity: 'limitation', text: 'هذه عينة معزولة، لا دليل على حفظ غسلات أو عمولات.' }],
    sources: [{ id: 'TEST-SOURCE', label: 'مصدر اصطناعي', sourceRef: 'SYNTHETIC-SOURCE', checkedAt: '2026-10-18T08:55:00+03:00', coverage: 'مصدر معزول فقط', status: 'partial' }],
    cases: [{ caseId: 'OPS-TEST', title: 'حالة اختبار', ownerRole: 4, status: 'open', evidence: 'الدليل الجزئي عند القطع', next: 'التحقق من المصدر قبل الإغلاق' }],
    sections: [{ id: 'TEST-DETAIL', title: 'تفاصيل اصطناعية', text: 'النص العربي يبقى حرفيًا.', columns: ['مرحلة', 'عدد'], rows: [['قراءة', 3], ['غير متاح', null]] }],
    historicalIntegrity: 'لا يضاف إلى هذه اللقطة دليل أحدث من القطع ولا تعتبر أرقامها حالية.',
    ...overrides,
  };
  if (!report.reportId) report.reportId = operationsReportId(report);
  return report;
}
