export const isFirebaseConfigured = true;
export const missingEnvNames = [];
export const describeBackendError = (error) => error?.message || 'خطأ اختبار';
export const maskedProjectRef = () => null;
const accounts = [
  { code: '1010', nameArabic: 'الصندوق', accountType: 'asset', normalBalance: 'debit' },
  { code: '1020', nameArabic: 'البنك', accountType: 'asset', normalBalance: 'debit' },
  { code: '2000', nameArabic: 'موردون', accountType: 'liability', normalBalance: 'credit' },
  { code: '3000-demo', nameArabic: 'شريك اختبار', accountType: 'equity', normalBalance: 'credit' },
  { code: '4000', nameArabic: 'إيرادات', accountType: 'revenue', normalBalance: 'credit' },
  { code: '5100', nameArabic: 'مصاريف', accountType: 'expense', normalBalance: 'debit' },
];
const entries = [
  { id: 'receipt', entryNumber: 10, entryDate: '2026-10-01', status: 'posted', sourceType: 'expense', sourceKind: 'variable', sourceId: 'invoice', description: 'شراء مستلزمات', createdBy: 'preview-user', createdAt: '2026-10-01T08:00:00Z' },
  { id: 'correction', entryNumber: 11, entryDate: '2026-10-02', status: 'posted', sourceType: 'adjustment', reversalOf: 'receipt', reversalReason: 'تصحيح مثبت في تجربة معزولة', description: 'تصحيح مبلغ', createdBy: 'preview-user', createdAt: '2026-10-02T08:00:00Z' },
  { id: 'manual', entryNumber: 12, entryDate: '2026-10-03', status: 'posted', sourceType: 'manual', description: 'رصيد اختبار', createdBy: 'preview-user', createdAt: '2026-10-03T08:00:00Z' },
];
const lines = [
  { entryId: 'receipt', accountId: '1010', debit: 0, credit: 120, description: 'سداد' },
  { entryId: 'receipt', accountId: '5100', debit: 120, credit: 0, description: 'مستلزمات' },
  { entryId: 'correction', accountId: '1010', debit: 20, credit: 0, description: 'تصحيح' },
  { entryId: 'correction', accountId: '5100', debit: 0, credit: 20, description: 'تصحيح' },
  { entryId: 'manual', accountId: '1010', debit: 10, credit: 0, description: 'رصيد اختبار' },
  { entryId: 'manual', accountId: '3000-demo', debit: 0, credit: 10, description: 'رصيد اختبار' },
];
const value = { accounts, entries, lines, accountIndex: new Map(accounts.map((a) => [a.code, a])), needsSeeding: false, loading: false, error: null, refetch: () => {} };
const documents = new Map([
  ['variable_expenses/invoice', { description: 'مستلزمات تنظيف اصطناعية', supplier: 'مورد اختبار', invoice_number: 'TEST-10', invoice_url: 'https://example.com/synthetic-invoice' }],
  ['users/preview-user', { name: 'مستخدم الاختبار' }],
]);
export function useLedger() { return value; }
export function useLedgerSourceDocuments() { return { documents, loading: false, error: null, refetch: () => {} }; }
export default function TopBar() { return <header className="p-4"><h1 className="text-xl font-bold">دفتر الأستاذ — اختبار</h1></header>; }
