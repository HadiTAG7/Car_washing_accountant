import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import TrialBalancePage from '../../src/components/TrialBalancePage';
import GeneralLedgerPage from '../../src/components/GeneralLedgerPage';
document.documentElement.classList.add('dark');
const page = new URLSearchParams(window.location.search).get('page');
createRoot(document.getElementById('root')).render(<><p className="p-3 text-center">اختبار اصطناعي معزول — عرض فقط بلا اتصال بقاعدة البيانات</p>{page === 'ledger' ? <GeneralLedgerPage /> : <TrialBalancePage />}</>);
