import { createRoot } from 'react-dom/client';
import FixedAssetsPage from '../../src/components/FixedAssetsPage';
import '../../src/index.css';
document.documentElement.classList.add('dark');
createRoot(document.getElementById('root')).render(<><p className="p-3 text-center">اختبار اصطناعي معزول — لا اتصال بالقاعدة ولا حفظ</p><FixedAssetsPage /><output id="fixture-action" className="p-4 block" /></>);
