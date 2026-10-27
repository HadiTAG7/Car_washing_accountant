// Read-only projections of saved snapshots. Never fetch today's balances for a
// historical report, parse amounts from prose, or mutate the archived JSON.
import { readableExecutiveText } from './executiveOwnerSummary.js';
import { needsReportWording } from './reportPublication.js';
import { withReportDate, stripReportDatePrefixes } from './reportDisplayHeading.js';

export const FINANCE_SNAPSHOT_ROWS = Object.freeze([
  { id:'revenue', label:'الإيراد', ids:['revenue','net-revenue','monthly-revenue'] },
  { id:'expenses', label:'المصروفات', ids:['expenses','total-costs','monthly-expenses'] },
  { id:'net-profit', label:'نتيجة الشهر', ids:['net-profit','netProfit','monthly-result'] },
  { id:'bank-ledger', label:'البنك', ids:['bank-ledger'] },
  { id:'cash-ledger', label:'الصندوق', ids:['cash-ledger'] },
  { id:'vat-due', label:'الضريبة المستحقة', ids:['vat-due','vat-net'] },
]);
export const readableFinanceText = value => readableExecutiveText(value)
  .replace(/([ء-ي])([A-Za-z])/gu,'$1 $2').replace(/([A-Za-z])([ء-ي])/gu,'$1 $2');
const internalCode = /\b(?:CFO|Q[1-4]|TEST|FIN|OPS|SOURCE)(?:[-_][A-Za-z0-9]+)+\b/giu;
export function financeSentence(value, maxWords=20) {
  const plain=readableFinanceText(value).replace(internalCode,'').replace(/\s+/gu,' ').trim();
  const first=plain.split(/(?:[؛؟!]|\.(?!\d))/u)[0].trim();
  const words=first.split(/\s+/u).filter(Boolean);
  return words.length>maxWords?`${words.slice(0,maxWords).join(' ')}…`:first;
}
export const financeSearchText = value => readableFinanceText(value).normalize('NFKC')
  .replace(/[٠-٩]/gu,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).toLocaleLowerCase('ar-SA').replace(/\s+/gu,'');
const moneyUnit = value => /^(?:ريال|ر\.?\s?س\.?|SAR)$/iu.test(value||'');
const metricFor=(report,row)=>report?.financialSnapshot
  ? (()=>{const m=report.financialSnapshot.metrics.find(m=>m.id===row.id);return m&&{...m,unit:'ر.س',asOf:report.financialSnapshot.capturedAt};})()
  : (report?.metrics||[]).find(m=>row.ids.includes(m.id)&&moneyUnit(m.unit));
export function financeSnapshotRows(report, previous) {
  return FINANCE_SNAPSHOT_ROWS.map(row=>{
    const metric=metricFor(report,row), old=metricFor(previous,row);
    const isMoney=metric&&metric.basis!=='unavailable'&&Number.isFinite(metric.value);
    const comparable=isMoney&&old&&old.basis===metric.basis&&Number.isFinite(old.value)
      && previous.sourceRole===report.sourceRole && (report.financialSnapshot || previous.financialSnapshot
        ? Date.parse(old.asOf)<Date.parse(metric.asOf) : Date.parse(previous.cutAtRiyadh)<Date.parse(report.cutAtRiyadh))
      // Flows only compare snapshots of the same reporting month; balances can cross months.
      && (['bank-ledger','cash-ledger'].includes(row.id)||old.asOf.slice(0,7)===metric.asOf.slice(0,7));
    return {...row,metric:metric||null,value:isMoney?metric.value:null,delta:comparable?Math.round((metric.value-old.value)*100)/100:null};
  });
}
function amountIn(text) {
  const normalized=String(text).replace(/[٠-٩]/gu,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
  return Math.max(0,...[...normalized.matchAll(/(?:بمبلغ\s*|مبلغ\s+)([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s*(?:ريال|ر\.س|SAR)/giu)]
    .map(m=>Number((m[1]||m[2]).replaceAll(',',''))).filter(Number.isFinite));
}
export function financeReportNotes(report) {
  const notes=[];
  for(const row of financeSnapshotRows(report))if(['bank-ledger','cash-ledger'].includes(row.id)&&row.value<0)
    notes.push({id:row.id,severity:'critical',cash:true,amount:Math.abs(row.value),text:`رصيد ${row.label} الدفتري سالب: ${Math.abs(row.value).toLocaleString('ar-SA',{numberingSystem:'latn',maximumFractionDigits:2})} ريال؛ يحتاج مطابقة.`});
  for(const w of report.visibleWarnings||[]){
    const touchesCash=/الصندوق|البنك|النقد|السيولة|رأس\s*المال/u.test(w.text), amount=amountIn(w.text);
    // Coverage/tool limitations stay in the collapsed source report, unless they carry a material financial risk.
    if(w.severity==='limitation'&&!touchesCash&&amount<=1000&&/تغطية|الجولة|الأدوات|الحمولة|حد الاستخدام|فشل الاتصال|مقارنة الأسبوع/u.test(w.text))continue;
    // Small document details remain accessible in the technical section, not the owner summary.
    if(/مستند|فاتورة/u.test(w.text)&&amount>0&&amount<500&&!touchesCash)continue;
    let text=financeSentence(w.text);
    if(/تسوية.*غير جاهزة/u.test(w.text))text='تسوية سويتر غير جاهزة؛ المستحق يحتاج مراجعة.';
    if(/الصندوق.*سالب/u.test(w.text)&&notes.some(n=>n.id==='cash-ledger'))continue;
    if(text)notes.push({id:w.id,severity:touchesCash||amount>1000||w.severity==='critical'?'critical':'warning',cash:touchesCash,amount,text,needsWording:needsReportWording(w.text)});
  }
  return notes.sort((a,b)=>Number(b.cash)-Number(a.cash)||Number(b.severity==='critical')-Number(a.severity==='critical')||b.amount-a.amount);
}
export function financeOwnerDecisions(report) {
  return (report.cases||[]).filter(c=>c.status==='awaiting_owner').map(c=>({id:c.caseId,text:financeSentence(c.next),reason:financeSentence(c.evidence)}));
}
export function financeReportHeading(report) {
  const notes=financeReportNotes(report);
  const headline=notes.find(n=>n.id==='cash-ledger')?'الصندوق ما زال سالبًا':financeSentence(stripReportDatePrefixes(readableFinanceText(report.title).replace(/^المالية\s*[—:-]?\s*/u,''),report.dateRiyadh));
  return withReportDate(headline||'تقرير المالية المحفوظ', report.dateRiyadh);
}
export function financeReportSummary(report) {
  const notes=financeReportNotes(report);
  return notes.length?notes.slice(0,2).map(n=>n.text):[financeSentence(report.summary)];
}
