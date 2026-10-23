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
export const auth = null;
export const isFirebaseConfigured = false;
export const db = null;
export const missingEnvNames = [];
export const dataSource = 'firebase';
export const describeBackendError = error => String(error);
export const maskedProjectRef = () => null;
export const callLedger = async () => { throw new Error('Read-only synthetic preview'); };
const accounts = [{ code: '1010', nameArabic: 'الصندوق', accountType: 'asset', normalBalance: 'debit' },
  { code: '3000-test-partner', nameArabic: 'رأس مال — شريك اختباري', accountType: 'equity', normalBalance: 'credit', parentId: '3000' },
  { code: '4000', nameArabic: 'الإيرادات', accountType: 'revenue', normalBalance: 'credit' }];
const entries = [{ id: 'SYNTHETIC', status: 'posted', entryDate: '2026-10-01', entryNumber: 1 }];
const lines = [{ entryId: 'SYNTHETIC', accountId: '1010', debit: 100, credit: 0 }, { entryId: 'SYNTHETIC', accountId: '3000-test-partner', debit: 0, credit: 100 }];
export const useLedger = () => ({ accounts, entries, lines, accountIndex: new Map(accounts.map(account => [account.code, account])), periods: [], loading: false, error: null, needsSeeding: false, refetch: () => {} });
export const useOverviewDashboard = () => ({ finance: { statement: { netRevenue: 1234, totalCosts: 567 }, loading: false, error: null } });
export const useFinanceHomeData = month => ({ today: '2026-10-23', month, loading: false, problems: [], refresh: () => {},
  statement: { netRevenue: 1234, totalCosts: 1567, netProfit: -333 },
  ledger: { postedRevenue: 0, postedCosts: 500, cash: -50, bank: 300, availableCash: 250, capital: 500,
    negativeAccounts: [{ code: '1010', name: 'صندوق اختبار', balance: -50 }] },
  settlementReady: true, settlement: { status: 'calculated', figures: { netDue: 0, counts: { eligible: 0, imported: 12 } } },
  vat: { netTax: 23, unpostedEligible: [{}, {}], unpostedInputTax: 7 },
  workbench: { unknownPayment: { count: 4, amount: 410 }, pending: { count: 3, amount: 300 } },
  budget: { month: '2026-10', cards: [{ budget: { amount: 0 }, spent: 100 }], totals: { remaining: -100 } } });
// Dense, long mixed-direction labels reproduce the shrinking flex-list defect.
const recordItems = Array.from({ length: 20 }, (_, index) => ({ sourceId: `TEST-${index}`, title: `${index + 1} — مصروف اختبار طويل لصيانة المعدات وباقة الاتصالات (مستند Q4-TEST) — مرجع ${'SYNTHETIC'.repeat(8)}`, date: '2026-10-19', amount: 57.34, paymentStatus: 'unpaid' }));
export const useFinanceRead = (endpoint, request) => ({ allowed: true, loading: false, error: null, refresh: () => {},
  data: endpoint === 'finance-reports' ? request.action === 'list' ? { items: [corrected, intake] }
    : request.reportId === intake.reportId ? { report: intake, currentRevision: 1, history: [{ revision: 1, reason: 'الإصدار الأول' }] }
      : { report: request.revision === 1 ? report : corrected, currentRevision: 2, history: [{ revision: 2, reason: corrected.correctionReason }, { revision: 1, reason: 'الإصدار الأول' }] }
    : request.action === 'list' ? { items: recordItems, coverage: '20 سجلًا اصطناعيًا معزولًا فقط' }
      : request.action === 'options' ? { items: [{ id: 'TEST', label: 'تصنيف اختبار' }] } : { ...detail, sourceId: request.sourceId, row: { ...detail.row, expense_name: recordItems.find(item => item.sourceId === request.sourceId)?.title || detail.row.expense_name } } });
export const callFinanceApi = async () => { throw new Error('لا حفظ في الاختبار البصري؛ استخدم اختبارات المحاكي.'); };
export default function PreviewTopBar({ title, subtitle, isOpen }) {
  if (isOpen !== undefined) return null;
  return <header style={{ padding: '18px 24px' }}><h1 style={{ fontSize: 24, fontWeight: 800 }}>{title}</h1><p>{subtitle}</p></header>;
}
