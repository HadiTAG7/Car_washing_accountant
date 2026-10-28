// Dedicated entry keeps unrelated finance pages and their remote hooks outside
// this local-only workbench harness. Requests are aliased to memory storage.
import { createRoot } from 'react-dom/client';
import FinanceWorkbenchPage from '../../src/components/FinanceWorkbenchPage';
import '../../src/index.css';

createRoot(document.getElementById('root')).render(<>
  <header style={{ padding: 16, borderBottom: '3px solid #d97706' }}>
    <strong>اختبار معزول — بيانات اصطناعية في الذاكرة فقط، دون اتصال بالإنتاج</strong>
  </header>
  <FinanceWorkbenchPage />
</>);
