/* eslint-disable react-refresh/only-export-components -- isolated fixtures */
export const isFirebaseConfigured = true, missingEnvNames = [];
export const describeBackendError = error => error?.message || 'خطأ اختبار';
export const maskedProjectRef = () => null;
const accounts = [
  ['1010', 'الصندوق', 'asset', 'debit'], ['1500', 'أصول ثابتة', 'asset', 'debit'],
  ['1510', 'مجمع الإهلاك', 'asset', 'credit'], ['3000-demo', 'رأس مال — شريك تجريبي', 'equity', 'credit'],
  ['3100', 'أرباح محتجزة', 'equity', 'credit'], ['4000', 'إيراد', 'revenue', 'credit'],
  ['5010', 'رواتب', 'expense', 'debit'], ['5100', 'مصاريف', 'expense', 'debit'],
].map(([code, nameArabic, accountType, normalBalance]) => ({ code, nameArabic, accountType, normalBalance }));
const entries = [
  { id: 'capital', status: 'posted', entryDate: '2025-01-01', entryNumber: 1 },
  { id: 'prior', status: 'posted', entryDate: '2025-05-01', entryNumber: 2 },
  { id: 'bike', status: 'posted', entryDate: '2026-10-01', entryNumber: 3, sourceKind: 'startup', sourceId: 'b' },
  { id: 'phone', status: 'posted', entryDate: '2026-10-01', entryNumber: 4, sourceKind: 'startup', sourceId: 'p' },
  { id: 'franchise', status: 'posted', entryDate: '2026-10-01', entryNumber: 5, sourceKind: 'startup', sourceId: 'f' },
  { id: 'expense', status: 'posted', entryDate: '2026-10-02', entryNumber: 6 },
];
const lines = [['capital', '1010', 250, 0], ['capital', '3000-demo', 0, 250],
  ['prior', '5100', 10, 0], ['prior', '1010', 0, 10],
  ['bike', '1500', 60, 0], ['bike', '1010', 0, 60], ['phone', '1500', 30, 0], ['phone', '1010', 0, 30],
  ['franchise', '1500', 100, 0], ['franchise', '1010', 0, 100], ['expense', '5100', 140, 0], ['expense', '1010', 0, 140],
].map(([entryId, accountId, debit, credit]) => ({ entryId, accountId, debit, credit }));
export const ledgerFixture = { accounts, entries, lines, loading: false, error: null, refetch: () => {}, needsSeeding: false };
export function useLedger() { return ledgerFixture; }
export function useFeeRules() { return { rules: [], loading: false, error: null }; }
export function usePartnerView() { return { role: 'admin', isPartnerView: false }; }
export function useBalanceAssetSources() { return {
  startupEntries: [{ id: 'b', startup_cost_id: 'b' }, { id: 'p', startup_cost_id: 'p' }, { id: 'f', startup_cost_id: 'f' }],
  startupItems: [{ id: 'b', item_name: 'الدباب' }, { id: 'p', item_name: 'جوالات' }, { id: 'f', item_name: 'رسوم الفرنشايز' }],
  assetSourcesReady: true, loading: false, error: null,
}; }
export function useIncomeStatementSources() { return { loading: false, error: null, sources: {
  washes: [{ id: 'wash', status: 'مكتملة', wash_date: '2026-10-01', quantity: 1, price: 20, price_mode: 'exclusive' }],
  variables: [], monthlies: [], annualEntries: [], vouchers: [], bookings: [], settlements: [],
} }; }
export function useIncomePayrollPreviews(periodKey) { return { loading: false, error: null, data: [{ periodKey, estimated: true, lines: [{ basicDue: 100, bonus: 0, deduction: 0 }] }] }; }
export function useAccountingSettings() { return { loading: false, error: null, settings: { vatRegistered: true, washPriceMode: 'exclusive', vatRate: .15,
  taxPolicyHistory: [{ effectiveFrom: '2025-01-01', vatRegistered: true, washPriceMode: 'exclusive', vatRate: .15 }] } }; }
export function useFinanceRead() { return { allowed: true, loading: false, error: null, data: { complete: true, items: [
  { kind: 'variable', sourceId: 'unposted', amount: 50, date: '2026-10-01', workflowStage: 'incomplete' },
  { kind: 'variable', sourceId: 'approved', amount: 80, date: '2026-10-01', workflowStage: 'approved' },
] } }; }
export function useLedgerSourceDocuments() { return { documents: new Map(), loading: false, error: null }; }
export default function TopBar() { return <header className="p-4"><h1 className="text-xl font-bold">المركز المالي — بيانات اصطناعية</h1></header>; }
