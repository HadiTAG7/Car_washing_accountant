/* eslint-disable react-refresh/only-export-components -- isolated browser fixtures */
import { periodReadiness } from '../../functions/src/periodReadiness';
const params = new URLSearchParams(window.location.search);
const role = params.get('role') || 'admin';
export const isFirebaseConfigured = true, missingEnvNames = [];
export const describeBackendError = error => error?.message;
export const maskedProjectRef = () => null;
export const useAuth = () => ({ user: { id: 'synthetic', role } });
export const usePartnerView = () => ({ canMutate: role !== 'partner', role });
const data = { journal_entries: [], chart_of_accounts: [{ id: '1010' }, { id: '1020' }],
  accounting_periods: ['2026-08', '2026-09', '2026-10'].map(periodKey => ({ periodKey, status: 'open' })) };
const result = { periods: ['2026-10', '2026-09', '2026-08'].map(key => periodReadiness(key, data, { today: '2026-10-24' })) };
export const useLedger = () => ({ entries: [], periods: data.accounting_periods, linesByEntry: new Map(), needsSeeding: false, loading: false, error: null, refetch: async () => {} });
export const fetchCloseReadiness = async () => result;
export const useFirestoreQuery = () => ({ data: result, loading: false, error: params.get('error') === 'yes' ? new Error('synthetic read failure') : null, refetch: async () => {} });
const record = text => { document.getElementById('fixture-action').textContent = text; };
export const useAccountingSettings = () => ({ settings: { vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15, vatFilingPeriod: 'quarterly', autoPost: false,
  taxPolicyHistory: [{ effectiveFrom: '2026-05-01', vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15 }] },
  update: async patch => record(`إعداد وهمي ${JSON.stringify(patch)}`), setPolicy: async patch => record(`سياسة وهمية ${JSON.stringify(patch)}`), seedPolicy: async () => {}, baselineFrom: '2026-05-01', policyConfigured: true });
export const closePeriod = async (key, { overrideReason }) => { if (!overrideReason) throw new Error('سبب مطلوب'); record(`إقفال وهمي ${key}: ${overrideReason}`); };
export const reopenPeriod = async () => {};
export const seedChartOfAccounts = async () => ({ created: 0 });
export const collectUnposted = async () => ({ ready: [], skipped: [], partners: [] });
export const postUnposted = async () => { throw new Error('Not in scope'); };
export const previewGeneration = async () => ({ toCreate: [], skipped: [], templateCount: 0 });
export const generateVouchers = async () => { throw new Error('Not in scope'); };
export const fetchVoucherBundle = async () => ({ vouchers: [] });
export const setVoucherInvoice = async () => {};
export const linkLegacyInvoices = async () => ({ candidates: 0, linkable: [], review: [] });
export default function TopBar() { return <header className="p-4">إقفال الفترة — اختبار معزول</header>; }
