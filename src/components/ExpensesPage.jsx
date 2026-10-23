import { lazy, Suspense, useRef } from 'react';
import LoadingState from './LoadingState';
import TopBar from './TopBar';
import { EXPENSE_TAB_IDS } from '../lib/navGroups';

const pages = {
  startup: lazy(() => import('./StartupPage')),
  annual: lazy(() => import('./AnnualExpensesPage')),
  monthly: lazy(() => import('./MonthlyExpensesPage')),
  variable: lazy(() => import('./VariableExpensesPage')),
  temporary_expenses: lazy(() => import('./TemporaryExpensesPage')),
};
const labels = ['التأسيس', 'السنوية', 'الشهرية', 'المتغيرة', 'المؤقتة'];

// Legacy page ids remain the URL/history contract. Only one existing expense
// screen is mounted: no duplicate queries, financial records or write paths.
export default function ExpensesPage({ activeTab, onNavigate, pendingEntry, onClearPendingEntry }) {
  const selected = EXPENSE_TAB_IDS.includes(activeTab) ? activeTab : 'startup';
  const buttons = useRef([]);
  const Page = pages[selected];
  function select(index) { onNavigate(EXPENSE_TAB_IDS[index]); buttons.current[index]?.focus(); }
  return <>
    <TopBar title="المصاريف" subtitle={labels[EXPENSE_TAB_IDS.indexOf(selected)]} />
    <div className="px-4 pt-4 sm:px-6" dir="rtl">
      <div role="tablist" aria-label="المصاريف" className="flex flex-wrap gap-2">
        {EXPENSE_TAB_IDS.map((id, index) => <button type="button" role="tab" key={id}
          ref={element => { buttons.current[index] = element; }} id={`expense-tab-${id}`}
          aria-selected={id === selected} aria-controls="expense-panel" tabIndex={id === selected ? 0 : -1}
          className={`sw-button sw-button--sm ${id === selected ? 'sw-button--primary' : 'sw-button--secondary'}`}
          onClick={() => select(index)} onKeyDown={event => {
            const next = event.key === 'ArrowLeft' ? (index + 1) % 5 : event.key === 'ArrowRight' ? (index + 4) % 5 : event.key === 'Home' ? 0 : event.key === 'End' ? 4 : null;
            if (next !== null) { event.preventDefault(); select(next); }
          }}>{labels[index]}</button>)}
      </div>
    </div>
    <div role="tabpanel" id="expense-panel" aria-labelledby={`expense-tab-${selected}`}>
      <Suspense fallback={<LoadingState message="جارٍ تحميل الصفحة..." />}>
        <Page embedded pendingEntry={pendingEntry} onClearPendingEntry={onClearPendingEntry} />
      </Suspense>
    </div>
  </>;
}
