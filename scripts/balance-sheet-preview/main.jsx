import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import BalanceSheetPage from '../../src/components/BalanceSheetPage';
import GeneralLedgerPage from '../../src/components/GeneralLedgerPage';
document.documentElement.classList.add('dark');
createRoot(document.getElementById('root')).render(<><p className="p-3 text-center">اختبار اصطناعي معزول — لا اتصال بالقاعدة ولا حفظ</p>{new URLSearchParams(window.location.search).get('page') === 'ledger' ? <GeneralLedgerPage /> : <BalanceSheetPage />}</>);
