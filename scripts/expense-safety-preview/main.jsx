import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import StartupPage from '../../src/components/StartupPage';
import AnnualExpensesPage from '../../src/components/AnnualExpensesPage';
import TemporaryExpensesPage from '../../src/components/TemporaryExpensesPage';
import '../../src/index.css';
export function Preview() {
  const [page, setPage] = useState('startup');
  return <><header className="p-4 border-b-4 border-orange-600"><strong>اختبار معزول ببيانات اصطناعية — لا اتصال بقاعدة الإنتاج</strong><nav className="flex gap-4 mt-4">{[['startup', 'التأسيس'], ['annual', 'السنوية'], ['temporary', 'المؤقتة']].map(([id, label]) => <button key={id} className="sw-button" onClick={() => setPage(id)}>{label}</button>)}</nav></header>
    {page === 'startup' ? <StartupPage /> : page === 'annual' ? <AnnualExpensesPage /> : <TemporaryExpensesPage />}</>;
}
createRoot(document.getElementById('root')).render(<Preview />);
