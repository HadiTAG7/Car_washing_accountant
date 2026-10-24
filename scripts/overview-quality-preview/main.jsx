import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import OverviewBikerQuality from '../../src/components/OverviewBikerQuality';
import OverviewBusinessInsights from '../../src/components/OverviewBusinessInsights';
import { overviewOperations } from '../../src/lib/overviewDashboard';
import { LanguageContext } from '../../src/i18n/LanguageContext';
import { bikers } from './data';
import '../../src/index.css';
import '../../src/components/OverviewPage.css';
document.documentElement.classList.add('dark');
export default function Preview() {
  const [language, setLanguage] = useState('ar');
  const [periodKey, setPeriod] = useState('2026-10');
  const operations = overviewOperations({ periodKey, today: '2026-10-24', bikers, washes: [
    { id: 'wash', quantity: 4, bikerId: 'one', washDate: '2026-10-23', status: 'مكتملة' },
  ] });
  const data = { operations, finance: { statement: { totalCosts: 1000, netRevenue: 80 } }, workers: { bikers },
    adjustments: { items: [] }, settlements: { items: [{ periodKey, figures: { netDue: 0, counts: { eligible: 0, needsReview: 2 } } }] },
    sweaterMetrics: { snapshot: { periodKey, extractedAtIso: '2026-10-24T06:00:00Z', metrics: { tipsNet: 73.13, violations: 530 } } } };
  return <LanguageContext.Provider value={{ language }}><main className="sw-overview" dir={language === 'en' ? 'ltr' : 'rtl'}>
    <p>معاينة اصطناعية معزولة — لا اتصال بالإنتاج ولا حفظ</p>
    <div><button type="button" onClick={() => setLanguage(v => v === 'ar' ? 'en' : 'ar')}>English / عربي</button>
      <select aria-label="شهر المعاينة" value={periodKey} onChange={e => setPeriod(e.target.value)}><option>2026-10</option><option>2026-09</option></select></div>
    <OverviewBusinessInsights data={data} periodKey={periodKey} washReady language={language} />
    <OverviewBikerQuality workers={{ bikers, loading: false }} periodKey={periodKey} today="2026-10-24" />
  </main></LanguageContext.Provider>;
}
createRoot(document.getElementById('root')).render(<Preview />);
