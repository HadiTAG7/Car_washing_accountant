import {createRoot} from 'react-dom/client';
import '../../src/index.css';
import BudgetsPage from '../../src/components/BudgetsPage.jsx';
document.documentElement.classList.add('dark');
createRoot(document.getElementById('root')).render(<><p className="p-3 text-center">اختبار اصطناعي معزول — لا اتصال بالإنتاج، وكل الحفظ والحذف معطّل</p><BudgetsPage/></>);
