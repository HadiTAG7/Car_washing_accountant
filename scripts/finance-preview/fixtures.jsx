/* eslint-disable react-refresh/only-export-components -- isolated visual harness aliases data hooks and the header, never a production entry */
import { financeFixture } from '../../server/__tests__/financeFixtures';
const report = financeFixture();
const corrected = financeFixture({ revision: 2, correctionReason: 'تصحيح اختباري لا يغير تاريخ النسخة الأولى', summary: 'نسخة ثانية اصطناعية لا تمثل عملًا حقيقيًا.' });
const intake = financeFixture({ sourceRole: 2, reportId: 'finance-2026-10-19-2-daily-2026-10-19-2026-10-19', title: 'تقرير تسجيل اختباري مستقل',
  review: { ...report.review, reviewerRole: 2 }, summary: 'اختبار فصل تقارير التسجيل عن تقرير المدير المالي.' });
const detail = { kind: 'variable', sourceId: 'TEST-ONLY', sourceHash: 'a'.repeat(64), approved: false, stage: 'incomplete', journalIds: [],
  row: { expense_name: 'مستند اختبار — غير حقيقي', total_variable_cost: 100, logged_date: '2026-10-19', quantity: 2, supplier: 'مورد اختبار', category_id: 'TEST', invoice_url: 'https://example.org/synthetic-invoice' },
  issues: ['نموذج بصري فقط؛ لا يمكن الحفظ أو الترحيل من هذه الصفحة.'], postingPreview: { ready: false, lines: [] } };
export const usePartnerView = () => ({ role: 'admin', isPartnerView: false });
export const useLedger = () => ({ accounts: [], entries: [], lines: [], periods: [], loading: false, error: 'بيانات الدفاتر غير متاحة في الاختبار البصري', needsSeeding: true, refetch: () => {} });
export const useFinanceRead = (endpoint, request) => ({ allowed: true, loading: false, error: null, refresh: () => {},
  data: endpoint === 'finance-reports' ? request.action === 'list' ? { items: [corrected, intake] }
    : request.reportId === intake.reportId ? { report: intake, currentRevision: 1, history: [{ revision: 1, reason: 'الإصدار الأول' }] }
      : { report: request.revision === 1 ? report : corrected, currentRevision: 2, history: [{ revision: 2, reason: corrected.correctionReason }, { revision: 1, reason: 'الإصدار الأول' }] }
    : request.action === 'list' ? { items: [{ sourceId: detail.sourceId, title: detail.row.expense_name, date: detail.row.logged_date, amount: 100 }], coverage: 'سجل اصطناعي معزول فقط' }
      : request.action === 'options' ? { items: [{ id: 'TEST', label: 'تصنيف اختبار' }] } : detail });
export const callFinanceApi = async () => { throw new Error('لا حفظ في الاختبار البصري؛ استخدم اختبارات المحاكي.'); };
export default function PreviewTopBar({ title, subtitle }) { return <header style={{ padding: '18px 24px' }}><h1 style={{ fontSize: 24, fontWeight: 800 }}>{title}</h1><p>{subtitle}</p></header>; }
