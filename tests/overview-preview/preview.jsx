import { createRoot } from 'react-dom/client';
import LanguageProvider from '../../src/i18n/LanguageProvider';
import OverviewPage from '../../src/components/OverviewPage';
import { BreakEvenHeaders, BreakEvenCells } from '../../src/components/BikerBreakEven';
import { bikerBreakEven } from '../../src/lib/breakEven';
import { useOverviewDashboard } from './fixture';
import '../../src/index.css';

export function BikerTableFixture() {
  const data = useOverviewDashboard('2026-10');
  const value = bikerBreakEven({ statement: data.finance.statement, payrollLines: data.payroll.data[0].lines,
    washes: data.operations.rows, bikers: data.workers.bikers, periodKey: '2026-10', today: '2026-10-21' });
  return <section dir="rtl" style={{ padding: 24, overflow: 'auto' }} aria-label="جدول التعادل التجريبي"><table><thead><tr><th>البايكر</th><BreakEvenHeaders /></tr></thead>
    <tbody>{data.workers.bikers.map(biker => <tr key={biker.id}><th>{biker.name}</th><BreakEvenCells state={{ status: 'ready', value }} bikerId={biker.id} /></tr>)}</tbody></table></section>;
}

createRoot(document.getElementById('root')).render(<LanguageProvider><OverviewPage onNavigate={tab => { document.getElementById('preview-navigation').textContent = tab; }} /><BikerTableFixture /><output id="preview-navigation" aria-label="Test navigation" /></LanguageProvider>);
