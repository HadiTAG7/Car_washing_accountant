import { createRoot } from 'react-dom/client';
import OperationsReportsPage from '../../src/components/OperationsReportsPage';
import '../../src/index.css';
createRoot(document.getElementById('root')).render(<><header style={{ padding: 16, borderBottom: '3px solid #ef7735' }}>اختبار معزول — بيانات اصطناعية، بلا Firebase أو اتصال بالإنتاج</header><OperationsReportsPage /></>);
