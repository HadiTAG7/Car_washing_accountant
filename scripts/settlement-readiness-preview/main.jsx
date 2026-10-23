import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import SweaterSettlementsPage from '../../src/components/SweaterSettlementsPage.jsx';
document.documentElement.classList.add('dark');
createRoot(document.getElementById('root')).render(<><p className="p-3 text-center">بيانات اختبار اصطناعية — لا اتصال بقاعدة الإنتاج، وكل الحفظ معطّل</p><SweaterSettlementsPage /></>);
