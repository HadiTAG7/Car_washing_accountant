import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import VatRecoveryPage from '../../src/components/VatRecoveryPage.jsx';
document.documentElement.classList.add('dark');
createRoot(document.getElementById('root')).render(<><p className="p-3 text-center">معاينة محلية اصطناعية — لا اتصال بالإنتاج، ولا حفظ أو تقديم</p><VatRecoveryPage/></>);
