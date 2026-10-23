/* eslint-disable react-refresh/only-export-components -- isolated UI test adapters */
import { DEFAULT_CHART_OF_ACCOUNTS } from '../../src/lib/accounting/chartOfAccounts';
export const incomePayrollMonths = periodKey => [periodKey];
const entries = [{ id: 'synthetic-september-payroll', entryDate: '2026-10-04', status: 'posted', sourceKind: 'payroll',
  payrollSnapshot: { periodKey: '2026-09' }, entryNumber: 1,
  lines: [{ accountId: '5010', debit: 20280, credit: 0 }, { accountId: '1010', debit: 0, credit: 20280 }] },
{ id: 'synthetic-purchase', entryDate: '2026-10-05', status: 'posted', sourceKind: 'variable', sourceId: 'synthetic-posted', entryNumber: 2,
  lines: [{ accountId: '5100', debit: 559.83, credit: 0 }, { accountId: '1010', debit: 0, credit: 559.83 }] }];
const sources = { bikers: [], washes: Array.from({ length: 424 }, (_, i) => ({ id: `synthetic-wash-${i}`, quantity: 1, price: 20, wash_date: '2026-10-21', status: 'مكتملة', price_mode: 'exclusive' })),
  variables: [{ id: 'synthetic-posted', logged_date: '2026-10-05', total_variable_cost: 559.83 },
    { id: 'synthetic-unposted', logged_date: '2026-10-06', total_variable_cost: 4000.90, expense_name: 'مصروف اصطناعي' }],
  monthlies: [{ id: 'synthetic-monthly', recurrence: 'one_time', logged_date: '2026-10-05', total_monthly_cost: 43.58 }],
  annualEntries: [{ id: 'synthetic-insurance', spent_date: '2026-08-24', amount: 70000, description: 'تأمين اصطناعي' },
    { id: 'synthetic-rent', spent_date: '2026-08-16', amount: 18500, description: 'إيجار اصطناعي' },
    { id: 'synthetic-september-rent', spent_date: '2026-09-17', amount: 28600, description: 'إيجار سبتمبر اصطناعي' }], vouchers: [] };
export const useIncomeStatementSources = () => ({ sources, entries,
  lines: entries.flatMap(entry => entry.lines.map((line, index) => ({ ...line, id: `${entry.id}:${index}`, entryId: entry.id }))), loading: false });
export const useLedger = () => ({ accounts: DEFAULT_CHART_OF_ACCOUNTS, periods: [], loading: false });
export const useFeeRules = () => ({ rules: [] });
export const useAccountingSettings = () => ({ settings: { vatRegistered: true, washPriceMode: 'exclusive' } });
export const useBikers = () => ({ bikers: [] });
export const usePayrollRuns = () => ({ runs: [] });
export const useStatementMonths = () => ['2026-10', '2026-09', '2026-08'];
export const useIncomePayrollPreviews = () => ({ data: [{ periodKey: '2026-10', estimated: true, lines: [{ basicDue: 25432.26 }] }], loading: false });
export const usePartnerView = () => ({ role: 'admin', isPartnerView: false, scalingFactor: 1 });
export const useSweaterMetrics = periodKey => ({ snapshot: periodKey === '2026-10'
  ? { periodKey, metrics: { completedWashes: 501 }, metricSources: { completedWashes: { extractedAtIso: '2026-10-23T14:39:02Z' } } } : null, loading: false });
export const isFirebaseConfigured = true, missingEnvNames = [], db = null;
export const describeBackendError = error => error.message;
export const maskedProjectRef = () => null;
export const callLedger = async () => { throw Error('Synthetic read-only preview: writes disabled'); };
export default function TestTopBar({ title }) { return <header className="p-5"><h1 className="text-xl font-bold">{title}</h1></header>; }
