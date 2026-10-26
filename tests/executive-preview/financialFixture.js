import { REPORT_FINANCIAL_IDS } from '../../src/lib/reportPublication';
export const financialPreviewSnapshot = { version: 1, source: 'site-functions', month: '2026-10', requestedCutAt: '2026-10-22T23:00:00+03:00', capturedAt: '2026-10-26T19:30:00+03:00',
  metrics: REPORT_FINANCIAL_IDS.map((id, i) => ({ id, value: [60, 175, -115, 975, -12, 9][i], basis: [3, 4].includes(i) ? 'ledger' : 'operational', coverage: 'مصدر اختبار معزول · شهر أكتوبر' })) };
