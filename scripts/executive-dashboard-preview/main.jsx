import { createRoot } from 'react-dom/client';
import ExecutiveReportsPage from '../../src/components/ExecutiveReportsPage';
import Sidebar from '../../src/components/Sidebar';
import { visibleGroupsFor } from '../../src/lib/navGroups';
import { MobileMenuProvider, useMobileMenu } from '../../src/contexts/MobileMenuContext';
import LanguageProvider from '../../src/i18n/LanguageProvider';
import '../../src/index.css';
export default function Preview() {
  const menu = useMobileMenu();
  return <div className="min-h-screen flex"><Sidebar groups={visibleGroupsFor({role:'admin'})} activeTab="executive_reports" onSelectTab={()=>{}}
    mobileOpen={menu.open} onCloseMobile={()=>menu.setOpen(false)} desktopHidden={menu.desktopHidden} user={{email:'local-preview@example.test'}} />
    <div className={"flex-1 min-w-0 " + (!menu.desktopHidden ? 'md:mr-64' : '')}><ExecutiveReportsPage /><small style={{display:'block',padding:16}}>معاينة محلية للعرض فقط — لا اتصال بالإنتاج ولا حفظ</small></div></div>;
}
createRoot(document.getElementById('root')).render(<LanguageProvider><MobileMenuProvider><Preview /></MobileMenuProvider></LanguageProvider>);
