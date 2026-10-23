/* eslint-disable react-refresh/only-export-components -- synthetic adapters only */
import { subledgerReconciliation } from '../../src/lib/subledgerReconciliation';
export { isFirebaseConfigured, missingEnvNames, describeBackendError, maskedProjectRef, useLedgerSourceDocuments } from '../ledger-controls-preview/data';
import { useLedger as useFixtureLedger } from '../ledger-controls-preview/data';
export function useLedger() {
  const value = useFixtureLedger();
  return { ...value, accounts: [...value.accounts,
    { code: '1510', nameArabic: 'مجمع الإهلاك', normalBalance: 'credit', accountType: 'asset' },
    { code: '1100', nameArabic: 'الذمم المدينة', normalBalance: 'debit', accountType: 'asset' },
  ] };
}
export function usePartnerView() { return { role: 'admin', isPartnerView: false }; }
export function useTrialReconciliation(ledger, today) {
  return subledgerReconciliation({ ...ledger, today, temporaries: [{ amount: 140, status: 'pending' }],
    partners: [{ paidAmount: 500 }], sources: {
      payrollPreviews: Array.from({ length: Number(today.slice(5, 7)) }, (_, index) => ({
        periodKey: `${today.slice(0, 4)}-${String(index + 1).padStart(2, '0')}`, lines: [],
      })),
    }, policyAt: () => ({ known: true, vatRegistered: false, vatRate: .15, washPriceMode: 'inclusive' }) });
}
export default function TopBar() { return <header className="p-4"><h1 className="text-xl font-bold">ميزان المراجعة — اختبار اصطناعي</h1></header>; }
