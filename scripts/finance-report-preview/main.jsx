import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import FinanceReportsPage from '../../src/components/FinanceReportsPage';
import ExecutiveDailySummary from '../../src/components/ExecutiveDailySummary';
import { executiveFixture } from '../../server/__tests__/executiveFixture';
import { useFinanceRead } from './data';
import '../../src/index.css';
export function PreviewExecutive() {
  const report = executiveFixture(), finance = useFinanceRead('finance-reports', { action: 'forExecutive', at: report.cutAtRiyadh });
  return <main style={{ padding: 24 }}><ExecutiveDailySummary report={report} finance={finance} /></main>;
}
export function Preview() {
  const [page, setPage] = useState('finance');
  return <><header style={{ padding: 18, borderBottom: '3px solid #d97706' }}><strong>اختبار معزول — 66 تقريرًا اصطناعيًا، لا إنتاج ولا نشر تقارير</strong>
    <nav style={{ display: 'flex', gap: 14, marginTop: 12 }}><button onClick={() => setPage('finance')}>تقارير المالية</button><button onClick={() => setPage('executive')}>التنفيذي من المصدر نفسه</button></nav></header>
    {page === 'finance' ? <FinanceReportsPage /> : <PreviewExecutive />}</>;
}
createRoot(document.getElementById('root')).render(<Preview />);
