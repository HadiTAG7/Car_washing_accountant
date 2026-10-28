import { useState } from 'react';
import { usePartnerView } from '../contexts/PartnerViewContext';
import { useOperationsWorkspace } from '../hooks/useOperationsWorkspace';
import { riyadhToday } from '../lib/bikerProfile';
import { formatNumber } from '../data/initialData';
import { importStamp } from '../lib/sweaterFreshness';
import { operationsReadinessText } from '../lib/operationsWorkspace';
import TopBar from './TopBar';
import BikerProfileMonthPicker from './BikerProfileMonthPicker';
import { Card, SectionHeader } from './UI';
import { FreshnessBarView } from './SweaterFreshnessBar';
import './FinanceWorkspace.css';
import './FinanceHomePage.css';
import './OperationsWorkspacePage.css';

const n=value=>value==null?'غير متاح':formatNumber(Math.round(value*100)/100);
const pct=value=>value==null?'غير متاح':`${n(value*100)}%`;
function Metric({title,value,note,href,date}) {
  return <a className="fm-card" href={href}><span className="fm-card__top">{title}</span><strong className="fm-card__value">{value}</strong>
    <span className="fm-card__note">{note}</span><span className="fm-card__footer">{date} · عرض التفاصيل ←</span></a>;
}
export function OperationsChecks({value}) {
  return <Card className="p-4 sm:p-5 space-y-4"><h2 className={`font-bold ${value.ready?'text-emerald-600 dark:text-emerald-400':'text-rose-600 dark:text-rose-400'}`}>{operationsReadinessText(value)}</h2>
    <ul className="space-y-3" aria-label="قائمة فحص شهر التشغيل">{value.checks.map(check=><li key={check.id} className={check.ok?'text-emerald-600 dark:text-emerald-400':'text-rose-600 dark:text-rose-400'}>
      <a className="underline underline-offset-4" href={check.href}>{check.ok?'✓':'✗'} {check.label} · {n(check.count)}</a>{check.note&&<small className="block text-slate-500 dark:text-slate-400 mt-1">{check.note}</small>}
    </li>)}</ul><p className="text-sm text-slate-500 dark:text-slate-400">قائمة متابعة للقراءة فقط؛ لا تقفل شهرًا ولا تعتمد تسوية أو ترحّل قيدًا.</p>
  </Card>;
}
export default function OperationsWorkspacePage({close=false}) {
  const view=usePartnerView();
  return view.role==='admin'&&!view.isPartnerView?<OperationsWorkspaceContent close={close}/>:null;
}
export function OperationsWorkspaceContent({close=false}) {
  const today=riyadhToday();
  const [month,setMonth]=useState(()=>{const requested=new URLSearchParams(window.location.search).get('period');return /^\d{4}-(0[1-9]|1[0-2])$/.test(requested||'')&&requested<=today.slice(0,7)?requested:today.slice(0,7);});
  const read=useOperationsWorkspace(month),v=read.value;
  const href=page=>`?page=${page}&period=${month}`;
  const qualityNote=v.qualityDetailsComplete?'من صفحة الجودة والمخالفات':'ما وصلت تفاصيل سويتر كاملة؛ المجاميع من آخر لقطة متاحة.';
  return <><TopBar title={close?'إقفال شهر التشغيل':'ملخص العمليات'} subtitle="متابعة الشهر من البيانات المحفوظة — قراءة فقط"/>
    <main className="fw-page fm-page ow-page" dir="rtl">
      <div className="fw-toolbar"><BikerProfileMonthPicker value={month} max={today.slice(0,7)} language="ar" onChange={setMonth}/>
        <button className="sw-button sw-button--secondary" onClick={read.retry}>تحديث البيانات</button></div>
      <FreshnessBarView {...read.freshness}/>
      <p className="fm-posting-note">الأيام المكتملة تستبعد اليوم الجاري. موارد السكن والأسطول تعرض وضعها الحالي، وليست لقطة تاريخية للشهر.</p>
      {read.loading?<p role="status">جارٍ قراءة بيانات العمليات...</p>:<>
        {read.error&&<p role="alert" className="fm-read-error">تعذرت قراءة بعض المصادر؛ لا تعتبر البنود غير المتاحة ناجحة.</p>}
        {close?<OperationsChecks value={v}/>:<>
          <section aria-label="سطر الشهر"><SectionHeader title="هذا الشهر"/><div className="fm-grid fm-grid--month">
            <Metric title="الغسلات المسجلة مقابل سويتر" value={`${n(v.quantity)} / ${n(v.sweater)}`} note={`قراءة عدد سويتر: ${importStamp(v.sweaterReadAt)} · الأوقات قد تختلف.`} href={href('washes')} date={month}/>
            <Metric title="متوسط الفريق في اليوم مقابل التعادل" value={`${n(v.dailyActual)} / ${n(v.dailyRequired)}`} note="غسلة / يوم · نفس تعريف النظرة العامة" href={href('today')} date={month}/>
            <Metric title="الشغالون والخاملون" value={`${n(v.working)} / ${n(v.idle)}`} note="تصنيف تبويب الخاملين في المسير" href={href('bikers')+'&bikerTab=idle'} date={month}/>
            <Metric title="الفعلي لكل بايكر والتغطية" value={`${n(v.actualPerBiker)} · ${pct(v.coverage)}`} note="غسلة / يوم عمل متاح مكتمل" href={href('bikers')} date={month}/>
          </div></section>
          <section aria-label="سطر الجودة"><SectionHeader title="الجودة"/><div className="fm-grid fm-grid--money">
            <Metric title="المخالفات" value={`${n(v.violations)} ر.س`} note={qualityNote} href={href('quality_violations')} date={month}/>
            <Metric title="إلغاءات البايكر" value={n(v.cancellations)} note={qualityNote} href={href('quality_violations')} date={month}/>
            <Metric title="الغسلات المجانية" value={n(v.freeWashes)} note={qualityNote} href={href('quality_violations')} date={month}/>
          </div></section>
          <section aria-label="سطر الموارد"><SectionHeader title="الموارد"/><div className="fm-grid fm-grid--money">
            <Metric title="السكن: نشطون / يحتاج إخلاء / أسرّة فاضية" value={`${n(v.housingActive)} / ${n(v.housingInactive)} / ${n(v.vacancies)}`} note="الفاضي فعليًا لا يشمل أسرّة المقيمين الذين ينتظرون الإخلاء." href={href('housing')} date={today}/>
            <Metric title="الأسطول: مسجل / شغال / صيانة" value={`${n(v.registered)} / ${n(v.workingBikes)} / ${n(v.repairBikes)}`} note="سجل الأسطول الحالي؛ التأسيس يستهدف 50 دبابًا." href={href('fleet')} date={today}/>
          </div></section>
          <section className="fm-actions"><SectionHeader title="يحتاج إجراء"/><ul>{v.actions.map(row=><li key={row.id}><a className="ow-action" href={row.href}><span>{row.label}</span><b>{n(row.count)}</b><span>←</span></a></li>)}</ul>
            {!v.actions.length&&!v.unknown&&<p>ما فيه شي يحتاج إجراء</p>}{v.unknown&&<p className="fm-incomplete">بعض المصادر غير مكتملة؛ لا يمكن تأكيد خلو الشهر من الملاحظات.</p>}
            {v.nearDeadline===null&&<p className="fm-incomplete">مهلة الاعتراض غير محددة أو غير متاحة؛ لم نفترض تاريخًا.</p>}
          </section>
          <a className="sw-button sw-button--secondary mt-4" href={href('operations_close')}>{operationsReadinessText(v)} · فتح قائمة الفحص</a>
        </>}
      </>}
    </main></>;
}
