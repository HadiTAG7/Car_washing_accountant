/* eslint-disable react-refresh/only-export-components -- isolated fixture seam */
import {financeFixture} from '../../server/__tests__/financeFixtures';
import {financeSearchText} from '../../src/lib/financeReportPresentation';
const reports=Array.from({length:40},(_,i)=>{
  const date=`2026-10-${String(24-Math.floor(i/3)).padStart(2,'0')}`,role=i%3+1;
  const metric=(id,value,basis='ledger')=>({id,label:id,value,basis,unit:'ريال',coverage:'لقطة اصطناعية معزولة',asOf:`${date}T09:00:00+03:00`});
  const report=financeFixture({dateRiyadh:date,cutAtRiyadh:`${date}T10:00:00+03:00`,sourceRole:role,
    reportId:`finance-${date}-${role}-daily-${date}-${date}`,period:{kind:'daily',from:date,to:date},title:`تقرير اصطناعي ${i+1}`,
    summary:'الصندوق يحتاج مطابقة، ولا تعني أرصدة الدفتر سيولة فعلية.',
    metrics:i===39?[]:[metric('revenue',7640,'operational'),metric('expenses',30036.57,'operational'),metric('net-profit',-22396.57,'estimate'),metric('bank-ledger',663937.12),metric('cash-ledger',-422957.12),metric('vat-due',902.92,'operational')],
    visibleWarnings:[{id:'cash',severity:'open',text:'الصندوق سالب ويحتاج مطابقة.'},{id:'settlement',severity:'open',text:'تسوية سويتر غير جاهزة؛ المستحق يحتاج مراجعة.'},
      {id:'big',severity:'open',text:'مصروف بمبلغ 2000 ريال يحتاج مراجعة.'}],
    cases:[{caseId:'SYNTHETIC-OWNER',title:'قرار اصطناعي',ownerRole:1,status:'awaiting_owner',evidence:'الرصيد يحتاج دليلًا مستقلًا.',next:'هل توافق على مراجعة المطابقة؟'}]});
  report.review.at=`${date}T09:00:00+03:00`;
  report.sources=report.sources.map(s=>({...s,checkedAt:`${date}T09:00:00+03:00`}));
  if(i===39)report.summary='معلومة قديمة40 للبحث عبر الأرشيف.';
  return report;
});
export function useFinanceRead(_endpoint,r,enabled=true){
  const base={allowed:true,loading:false,error:null,refresh:()=>{}};
  if(!enabled)return {...base,data:null};
  if(r.action==='list'){
    const found=reports.filter(x=>(!r.sourceRole||x.sourceRole===r.sourceRole)&&(!r.from||x.dateRiyadh>=r.from)&&(!r.to||x.dateRiyadh<=r.to)
      &&(!r.query||financeSearchText(JSON.stringify(x)).includes(financeSearchText(r.query))));
    const page=r.page||1,size=r.pageSize||8;
    return {...base,data:{items:found.slice((page-1)*size,page*size),total:found.length,page,pageSize:size,pageCount:Math.max(1,Math.ceil(found.length/size))}};
  }
  const report=reports.find(x=>x.reportId===r.reportId),previous=reports.find(x=>x.sourceRole===report?.sourceRole&&x.dateRiyadh<report.dateRiyadh);
  return {...base,data:{report,currentRevision:1,history:[{revision:1,reason:'اصطناعي'}],previousMetrics:previous}};
}
export async function callFinanceApi(){throw new Error('No writes or production transport in this synthetic preview');}
export default function PreviewTopBar({title}){return <header className="p-4"><h1>{title} — معاينة اصطناعية بلا اتصال بالإنتاج</h1><button onClick={()=>document.documentElement.classList.toggle('dark')}>تبديل المظهر الاختباري</button></header>;}
