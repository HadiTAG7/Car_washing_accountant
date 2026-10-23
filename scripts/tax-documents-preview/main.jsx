import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import SalesDocumentsPage from '../../src/components/SalesDocumentsPage';
import SettlementInvoicePanel from '../../src/components/SettlementInvoicePanel';
document.documentElement.classList.add('dark');
const query = new URLSearchParams(window.location.search);
const settlement = { status: query.get('approved') === 'yes' ? 'approved' : 'calculated', journalEntryId: 'synthetic-entry', figures: { services: { net: 40, vat: 6, gross: 46 } } };
createRoot(document.getElementById('root')).render(<><p className="p-3 text-center">اختبار اصطناعي معزول — لا اتصال بالقاعدة ولا حفظ</p>{query.get('view') === 'monthly'
  ? <main className="p-4"><SettlementInvoicePanel periodKey="2026-09" settlement={settlement} busy={false} onIssue={fn => fn()} /></main> : <SalesDocumentsPage />}</>);
