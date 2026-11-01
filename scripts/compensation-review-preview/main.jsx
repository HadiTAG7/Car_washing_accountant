import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CompensationReviewWorkspace } from '../../src/components/CompensationReviewWorkspace';
import { LanguageContext } from '../../src/i18n/LanguageContext';
import '../../src/index.css';
const query=new URLSearchParams(location.search),language=query.get('lang')==='en'?'en':'ar',role=query.get('role')||'owner';
document.documentElement.lang=language;document.documentElement.dir=language==='en'?'ltr':'rtl';
if(query.get('theme')!=='light')document.documentElement.classList.add('dark');
async function call(input){
  const response=await fetch('/__compensation-review?role='+role,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  const body=await response.json();if(body.error)throw Error(body.error.message);return body.result;
}
export function Fixture(){
  const [data,setData]=useState(null),[version,setVersion]=useState(0),[error,setError]=useState('');
  useEffect(()=>{if(role!=='partner')call({op:'read'}).then(setData).catch(e=>setError(e.message));},[version]);
  const read={allowed:role!=='partner',data,error,loading:!data&&!error,refresh:()=>setVersion(v=>v+1)};
  return <LanguageContext.Provider value={{language}}><header style={{padding:20,borderBottom:'3px solid #dc6600'}}>
    SYNTHETIC ISOLATED POSTGRES — no SSP or production connection</header><CompensationReviewWorkspace read={read} call={call}/></LanguageContext.Provider>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);


