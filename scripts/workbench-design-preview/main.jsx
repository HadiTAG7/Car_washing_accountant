import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import LanguageProvider from '../../src/i18n/LanguageProvider';
import { MobileMenuProvider, useMobileMenu } from '../../src/contexts/MobileMenuContext';
import Sidebar from '../../src/components/Sidebar';
import TopBar from '../../src/components/TopBar';
import FinanceWorkbenchPage from '../../src/components/FinanceWorkbenchPage';
import { visibleGroupsFor } from '../../src/lib/navGroups';
import '../../src/index.css';
import '../../src/components/OverviewPage.css';
document.documentElement.classList.add('dark');
export default function Preview() {
  useEffect(() => {
    // Append after Vite's injected styles: exercise the actual minified CSS
    // with shared finance styles last, where the first release failed.
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = '/__built-workbench-css';
    document.head.append(link);
    return () => link.remove();
  }, []);
  const [page, setPage] = useState('finance_workbench');
  const { open, setOpen, desktopHidden } = useMobileMenu();
  return <><Sidebar groups={visibleGroupsFor({ role: 'admin' })} activeTab={page} onSelectTab={setPage}
    mobileOpen={open} onCloseMobile={() => setOpen(false)} desktopHidden={desktopHidden} user={{ email: 'local-preview@example.test' }} />
    <div className={desktopHidden ? '' : 'md:mr-64'}><p className="p-4">معاينة اصطناعية — لا اتصال بالإنتاج ولا حفظ</p>
      {page === 'finance_workbench' ? <FinanceWorkbenchPage /> : <><TopBar title="نظرة عامة" /><main className="sw-overview">
        <div className="sw-overview-metric"><span>مرجع ألوان الموقع — بيانات اصطناعية</span><strong>123.45 ر.س</strong></div>
      </main></>}</div></>;
}
createRoot(document.getElementById('root')).render(<LanguageProvider><MobileMenuProvider><Preview /></MobileMenuProvider></LanguageProvider>);
