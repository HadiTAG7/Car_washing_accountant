import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { LanguageContext } from '../../src/i18n/LanguageContext';
import { loadEnglish } from '../../src/i18n/locale';
import { BIKER_DEDUCTION_TYPE, BIKER_DEDUCTION_AUTHORITY } from '../../src/lib/sweater/bikerDeductions';
import BikerDeductionFollowup from '../../src/components/BikerDeductionFollowup';
import '../../src/index.css';
import '../../src/components/QualityViolationsPage.css';
const row=(id,bikerId,amountSAR)=>({id,recordType:BIKER_DEDUCTION_TYPE,status:'recorded',bikerId,bikerName:`Test ${bikerId}`,decisionReference:BIKER_DEDUCTION_AUTHORITY,
  periodKey:'2026-10',metricKey:'cancelledByBiker',unit:'count',quantity:1,amountSAR,event:{metricKey:'cancelledByBiker',bookingId:`C-${id}`,date:'2026-10-20',quantity:1,amount:amountSAR,reason:'Synthetic source reason'}});
const records=[row('101','A',129.95),row('102','A',null),row('103','B',129.95),row('104','C',129.95)];
const noWrite=()=>{throw Error('No save or preview endpoint in this synthetic fixture');};
export default function Preview(){const[language,setLanguage]=useState(new URLSearchParams(location.search).get('lang')==='en'?'en':'ar');
  return <LanguageContext.Provider value={{language}}><main className="qv-page" dir={language==='en'?'ltr':'rtl'}>
    <p>Isolated synthetic data — no database, payroll, ledger or SSP connection.</p><button onClick={()=>setLanguage(language==='ar'?'en':'ar')}>Arabic / English</button>
    <BikerDeductionFollowup records={records} periodKey="2026-10" preview={noWrite} save={noWrite} disabled />
  </main></LanguageContext.Provider>;}
loadEnglish().then(()=>{document.documentElement.classList.add('dark');createRoot(document.getElementById('root')).render(<Preview/>);});
