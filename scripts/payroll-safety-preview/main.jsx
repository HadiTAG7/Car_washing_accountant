import { createRoot } from 'react-dom/client';
import BikerPayroll from '../../src/components/BikerPayroll';
import '../../src/index.css';
document.documentElement.classList.add('dark');
const role = new URLSearchParams(window.location.search).get('role') || 'admin';
createRoot(document.getElementById('root')).render(<main className="p-4"><p className="p-4">معاينة اصطناعية معزولة — لا اتصال بقاعدة الإنتاج</p><BikerPayroll role={role} /><output id="fixture-action" className="block p-4" /></main>);
