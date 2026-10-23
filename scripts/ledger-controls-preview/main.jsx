import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import GeneralLedgerPage from '../../src/components/GeneralLedgerPage';
document.documentElement.classList.add('dark');
createRoot(document.getElementById('root')).render(<><p className="p-3 text-center">اختبار اصطناعي معزول — عرض فقط بلا اتصال بقاعدة البيانات</p><GeneralLedgerPage /></>);
