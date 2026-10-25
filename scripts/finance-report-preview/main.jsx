import {createRoot} from 'react-dom/client';
import {useEffect} from 'react';
import FinanceReportsPage from '../../src/components/FinanceReportsPage';
import {LanguageContext} from '../../src/i18n/LanguageContext';
import '../../src/index.css';
document.documentElement.classList.add('dark');
export default function Preview(){
  useEffect(()=>{const link=document.createElement('link');link.rel='stylesheet';link.href='/__built-report-css';document.head.append(link);return()=>link.remove();},[]);
  return <LanguageContext.Provider value={{language:'ar'}}><FinanceReportsPage/></LanguageContext.Provider>;
}
createRoot(document.getElementById('root')).render(<Preview/>);
