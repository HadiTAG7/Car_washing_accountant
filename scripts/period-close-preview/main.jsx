import { createRoot } from 'react-dom/client';
import PeriodClosePage from '../../src/components/PeriodClosePage';
import '../../src/index.css';
document.documentElement.classList.add('dark');
createRoot(document.getElementById('root')).render(<><p className="p-4">معاينة اصطناعية معزولة — لا اتصال بقاعدة الإنتاج</p><PeriodClosePage /><output id="fixture-action" className="block p-4" /></>);
