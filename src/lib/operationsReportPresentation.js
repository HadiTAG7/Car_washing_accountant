import { financeSentence, readableFinanceText, financeOwnerDecisions } from './financeReportPresentation.js';
import { needsReportWording } from './reportPublication.js';
import { reportDateLabel, stripReportDatePrefixes } from './reportDisplayHeading.js';

// Operational references belong to the original technical report regardless
// of whether a name, noun, plural or punctuation precedes the booking number.
const opaqueNumber=/(?<![\d٠-٩.])[\d٠-٩]{7,}(?![\d٠-٩.])/gu;
export const needsOperationsSummaryWording=value=>needsReportWording(value)||/(?<![\d٠-٩.])[\d٠-٩]{7,}(?![\d٠-٩.])/u.test(value);
export function operationsSentence(value){return financeSentence(String(value||'').replace(/([\d٠-٩])([A-Za-z])/gu,'$1 $2').replace(/([A-Za-z])([\d٠-٩])/gu,'$1 $2')).replace(/\b[A-Za-z][A-Za-z0-9]*[-_][A-Za-z0-9_-]+\b/gu,'')
  .replace(/(الغسلة|الحجز|الحالة|حالة)\s*\d{5,}/gu,'$1').replace(opaqueNumber,'')
  .replace(/\bMCP\b/giu,'أداة الربط').replace(/\bSSP\b/giu,'منصة سويتر').replace(/\bERP\b/giu,'الموقع').replace(/\bB2B\b/giu,'الشركات')
  .replace(/\bCEO\b/giu,'الرئيس التنفيذي').replace(/\bCollecting\b/giu,'تحصيل').replace(/\bPayment\b/giu,'الدفع')
  .replace(/\s+/gu,' ').trim();}
export function operationsHeading(report){
  const date=reportDateLabel(report.dateRiyadh);
  let title=operationsSentence(stripReportDatePrefixes(readableFinanceText(report.title), report.dateRiyadh).split(/[—|]/u)[0]);
  if(needsReportWording(title))title=({sync:'متابعة الغسلات',morning_review:'ملخص التشغيل',assets:'متابعة الأصول والصيانة',weekly:'مراجعة تشغيل الأسبوع',targeted:'متابعة تشغيلية'})[report.kind]||'ملخص العمليات';
  return `${date}: ${title||'ملخص العمليات'}`;
}
export const operationsSummary=report=>{
  const lines=String(report.summary||'').split(/[؛؟!\n]|\.(?!\d)/u)
    .map(s=>readableFinanceText(s).replace(/(الغسلة|الحجز|الحالة|حالة)\s*[\d٠-٩]{7,}/gu,'$1'))
    .filter(s=>!needsOperationsSummaryWording(s)).map(s=>operationsSentence(s)).filter(Boolean).slice(0,2);
  return lines.length?lines:['ملخص هذا التقرير يحتاج صياغة أوضح؛ التفاصيل الأصلية محفوظة أدناه.'];
};
export function operationsNotes(report){return (report.visibleWarnings||[]).map(w=>({...w,text:operationsSentence(w.text),needsWording:needsReportWording(w.text)}))
  .filter(w=>w.text).sort((a,b)=>Number(b.severity==='critical')-Number(a.severity==='critical')||Number(b.severity==='open')-Number(a.severity==='open'));}
export const operationsDecisions=report=>financeOwnerDecisions(report).map(d=>({...d,text:operationsSentence(d.text),reason:operationsSentence(d.reason)}));
export { readableFinanceText as readableOperationsText };
