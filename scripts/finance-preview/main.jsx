import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import FinanceHomePage from '../../src/components/FinanceHomePage';
import FinanceReportsPage from '../../src/components/FinanceReportsPage';
import FinanceWorkbenchPage from '../../src/components/FinanceWorkbenchPage';
import '../../src/index.css';
export default function Preview() {
  const [page, setPage] = useState('finance');
  return <><header style={{ padding: 16, borderBottom: '3px solid #d97706' }}><strong>اختبار معزول — لا اتصال بالإنتاج ولا أرقام حقيقية</strong><nav style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12 }}>
    <button onClick={() => setPage('finance')}>المالية</button><button onClick={() => setPage('finance_workbench')}>صندوق العمل</button><button onClick={() => setPage('finance_reports')}>التقارير والأرشيف</button>
  </nav></header>{page === 'finance_reports' ? <FinanceReportsPage /> : page === 'finance_workbench' ? <FinanceWorkbenchPage /> : <FinanceHomePage onNavigate={setPage} />}</>;
}
createRoot(document.getElementById('root')).render(<Preview />);
