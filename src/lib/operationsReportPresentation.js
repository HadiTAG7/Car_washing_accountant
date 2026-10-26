import { financeSentence, readableFinanceText, financeOwnerDecisions } from './financeReportPresentation.js';
import { needsReportWording } from './reportPublication.js';

export function operationsSentence(value){return financeSentence(value).replace(/\b[A-Za-z][A-Za-z0-9]*[-_][A-Za-z0-9_-]+\b/gu,'')
  .replace(/(الغسلة|الحجز|الحالة|حالة)\s*\d{5,}/gu,'$1').replace(/\s+/gu,' ').trim();}
export function operationsHeading(report){
  const date=new Intl.DateTimeFormat('ar-SA-u-ca-gregory',{day:'numeric',month:'long',numberingSystem:'latn',timeZone:'UTC'}).format(new Date(`${report.dateRiyadh}T00:00:00Z`));
  const title=operationsSentence(String(report.title||'').split(/[—|]/u)[0]);
  return `${date}: ${title||'ملخص العمليات'}`;
}
export const operationsSummary=report=>{
  const lines=String(report.summary||'').split(/[؛؟!\n]|\.(?!\d)/u).filter(s=>!needsReportWording(s)).map(s=>operationsSentence(s)).filter(Boolean).slice(0,2);
  return lines.length?lines:['تفاصيل التقرير محفوظة في القسم التقني.'];
};
export function operationsNotes(report){return (report.visibleWarnings||[]).map(w=>({...w,text:operationsSentence(w.text),needsWording:needsReportWording(w.text)}))
  .filter(w=>w.text).sort((a,b)=>Number(b.severity==='critical')-Number(a.severity==='critical')||Number(b.severity==='open')-Number(a.severity==='open'));}
export const operationsDecisions=report=>financeOwnerDecisions(report).map(d=>({...d,text:operationsSentence(d.text),reason:operationsSentence(d.reason)}));
export { readableFinanceText as readableOperationsText };
