import { useEffect, useId, useRef, useState } from 'react';
import TopBar from './TopBar';
import { useAuth } from '../hooks/useAuth';
import { usePartnerView } from '../contexts/PartnerViewContext';
import { useExecutiveReportQuery, requestExecutiveReport } from '../hooks/useExecutiveReports';
import { parseExecutiveReport, EXECUTIVE_STATES } from '../lib/executiveReportContract';
import { AGENT_CATALOG } from '../lib/agentOrganization';
import { riyadhTodayISO } from '../lib/washesYesterday';
import { LanguageContext } from '../i18n/LanguageContext';
import './ExecutiveReportsPage.css';
import ExecutiveDailySummary, { ExecutiveDailySummaryLive } from './ExecutiveDailySummary';
import { needsReportWording } from '../lib/reportPublication';

const roleName=role=>AGENT_CATALOG.find(x=>x.number===role)?.name||String(role);
const number=value=>value==null?'غير متاح':new Intl.NumberFormat('ar-SA',{numberingSystem:'latn',maximumFractionDigits:2}).format(value);
const date=value=>new Intl.DateTimeFormat('ar-SA-u-ca-gregory',{numberingSystem:'latn',timeZone:'Asia/Riyadh',dateStyle:'medium',timeStyle:'short',hourCycle:'h23'}).format(new Date(value));
const tabs=[['daily','ملخص اليوم'],['decisions','متابعة القرارات'],['weekly','المراجعة الأسبوعية']];
const kindName={independent:'تحقق مستقل',owner:'تحقق المالك',self:'تحقق ذاتي — ليس مستقلًا'};
const reviewedLanguage={language:'ar'}; // Archived tabs stay verbatim; the daily projection never rewrites the snapshot.

const shortTitle = value => value.split(/[؛.!؟]/u)[0];
export function ExecutiveReportView({report,currentRevision=report.revision,selectedTab,onTabChange,dailySummary}){
  const viewId=useId();
  const [localTab,setLocalTab]=useState('daily'),[status,setStatus]=useState('all'),[owner,setOwner]=useState('all'),[search,setSearch]=useState('');
  const tab=selectedTab||localTab, tabRefs=useRef(new Map()), resetRef=useRef(null);
  const selectTab=next=>{setLocalTab(next);onTabChange?.(next);};
  const openDecisions=()=>{selectTab('decisions');tabRefs.current.get('decisions')?.focus();};
  const counts=Object.fromEntries(Object.keys(EXECUTIVE_STATES).map(key=>[key,report.decisions.filter(d=>d.status===key).length]));
  const query=search.trim().toLocaleLowerCase('ar-SA');
  const decisions=report.decisions.filter(d=>(status==='all'||d.status===status)&&(owner==='all'||String(d.ownerRole)===owner)
    &&(!query||[d.caseId,d.decision,d.next,roleName(d.ownerRole)].join(' ').toLocaleLowerCase('ar-SA').includes(query)));
  const reset=()=>{setStatus('all');setOwner('all');setSearch('');};
  return <LanguageContext.Provider value={reviewedLanguage}><article className="sw-executive" dir="rtl" translate="no">
    {tab!=='daily'&&<><header className="sw-executive__hero">
      <div className="sw-executive__snapshot"><span className="sw-executive__pill">لقطة محفوظة</span><span>{report.dateRiyadh}</span><span>نسخة {number(report.revision)}</span><time dateTime={report.cutAtRiyadh}>القطع {date(report.cutAtRiyadh)}</time></div>
      <h2>{report.title}</h2>
      {report.dateRiyadh!==riyadhTodayISO()&&<p className="sw-executive__dated">هذا تقرير {report.dateRiyadh}؛ ليس ملخص اليوم الحالي.</p>}
      {report.revision<currentRevision&&<p className="sw-executive__warning">تعرض نسخة قديمة. أحدث نسخة محفوظة: {number(currentRevision)}.</p>}
      <p className="sw-executive__summary">{report.summary}</p>
    </header>
    <div className="sw-executive__metrics">{report.metrics.map(m=><section key={m.id} aria-label={m.label}>
      <h3>{m.label}</h3><strong>{number(m.value)} <small>{m.unit}</small></strong><p>{m.coverage}</p>
      {m.asOfRiyadh&&<time dateTime={m.asOfRiyadh}>{date(m.asOfRiyadh)}</time>}
    </section>)}</div>
    {!report.metrics.length&&<p>لا توجد مؤشرات متحققة مرفقة؛ لا تُستبدل بأصفار.</p>}
    <section aria-label="التحذيرات وحدود التقرير" className="sw-executive__warnings"><h3>قيود تؤثر في قراءة النتائج</h3><div>
      {report.visibleWarnings.map(w=><p key={w.id} className="sw-executive__warning" data-severity={w.severity}><span aria-hidden="true">!</span>{w.text} {needsReportWording(w.text)&&<span className="report-wording-warning">تحتاج صياغة</span>}</p>)}
    </div></section>
    <section className="sw-executive__owner" aria-label="قرار المالك عند القطع"><span>{report.ownerAction.requiredAtCut?'يتطلب قرار هادي عند القطع: ':'قرار المالك عند القطع: '}</span><p>{report.ownerAction.text}</p></section></>}
    <div role="tablist" aria-label="أقسام التقارير" className="sw-executive__tabs">
      {tabs.map(([key,label],i)=><button key={key} ref={el=>{if(el)tabRefs.current.set(key,el);else tabRefs.current.delete(key);}}
        type="button" role="tab" id={`${viewId}-tab-${key}`} aria-controls={`${viewId}-panel-${key}`} aria-selected={tab===key} tabIndex={tab===key?0:-1}
        onClick={()=>selectTab(key)} onKeyDown={e=>{let next;
          if(e.key==='ArrowLeft')next=(i+1)%3;else if(e.key==='ArrowRight')next=(i+2)%3;else if(e.key==='Home')next=0;else if(e.key==='End')next=2;
          if(next!=null){e.preventDefault();selectTab(tabs[next][0]);tabRefs.current.get(tabs[next][0])?.focus();}}}>{label}</button>)}
    </div>
    <section role="tabpanel" id={`${viewId}-panel-${tab}`} aria-labelledby={`${viewId}-tab-${tab}`} tabIndex={0} className="sw-executive__content">
      {tab==='daily'&&<>
        {report.revision<currentRevision&&<p className="sw-executive__warning">تعرض نسخة قديمة. أحدث نسخة محفوظة: {number(currentRevision)}.</p>}
        {dailySummary||<ExecutiveDailySummary report={report}/>}
        <details className="sw-executive-daily__tracking"><summary>أعداد المتابعة في التقرير</summary>
        <section className="sw-executive__queue" aria-label="حالات التقرير عند القطع"><div><h3>أين وصلت المتابعة؟</h3><p>حالات التقرير المختار فقط، لا نسب إنجاز.</p></div>
          <div className="sw-executive__counts"><button type="button" onClick={()=>{reset();openDecisions();}}><strong>{number(report.decisions.length)}</strong><span>كل الحالات</span></button>
            {Object.entries(EXECUTIVE_STATES).map(([key,label])=><button type="button" key={key} onClick={()=>{setStatus(key);setOwner('all');setSearch('');openDecisions();}}><strong>{number(counts[key])}</strong><span>{label}</span></button>)}</div>
        </section></details>
      </>}
      {tab==='decisions'&&<>
        <div className="sw-executive__section-heading"><h3>متابعة القرارات</h3><p>حالات ضمن التقرير المختار حتى وقت قطعه؛ وصول التكليف لا يعني تنفيذه.</p></div>
        <div className="sw-executive__filters"><label>الحالة<select value={status} onChange={e=>setStatus(e.target.value)}><option value="all">كل الحالات</option>{Object.entries(EXECUTIVE_STATES).map(([id,label])=><option key={id} value={id}>{label} ({number(counts[id])})</option>)}</select></label>
          <label>المدير<select value={owner} onChange={e=>setOwner(e.target.value)}><option value="all">كل المدراء</option>{[...new Set(report.decisions.map(d=>d.ownerRole))].sort((a,b)=>a-b).map(r=><option value={String(r)} key={r}>{roleName(r)}</option>)}</select></label>
          <label>البحث في القرارات<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="ابحث في القرار أو المسؤول" /></label>
          <button ref={resetRef} className="sw-executive__reset" type="button" onClick={reset}>مسح التصفية</button>
        </div>
        <p role="status" aria-live="polite" className="sw-executive__result-count">{number(decisions.length)} من {number(report.decisions.length)} حالة</p>
        <div className="sw-executive__decision-grid">{decisions.map(d=><details className="sw-executive__decision" key={d.caseId} data-priority={d.priority}>
          <summary aria-label={`تفاصيل القرار: ${shortTitle(d.decision)}`}>
            <div className="sw-executive__decision-meta"><span className="sw-executive__pill">{EXECUTIVE_STATES[d.status]}</span><span>أولوية {number(d.priority)}</span><span>{roleName(d.ownerRole)}</span></div>
            <h3 title={shortTitle(d.decision)}>{shortTitle(d.decision)}</h3><p className="sw-executive__next"><span>الخطوة التالية:</span> {d.next}</p>
            {d.checkpointRiyadh&&<p className="sw-executive__checkpoint">نقطة المتابعة: {date(d.checkpointRiyadh)} <span>— متابعة، لا موعد إنجاز مؤكد</span></p>}
            <span className="sw-executive__open-hint">الدليل وسجل التغير</span>
          </summary>
          <div className="sw-executive__decision-body"><p>{d.decision}</p><p>معرف الحالة: <bdi>{d.caseId}</bdi></p>
            {d.checkpointMeaning&&<p>{d.checkpointMeaning}</p>}{d.coordinationOwnerRole!=null&&<p>تنسيق المتابعة: {roleName(d.coordinationOwnerRole)}</p>}
            <p>الدليل: {d.evidenceLevel}{d.evidenceRef&&<> · <bdi>{d.evidenceRef}</bdi></>}</p>
            {d.verification&&<p>{kindName[d.verification.kind]} · {roleName(d.verification.reviewerRole)} · <bdi>{d.verification.sourceRef}</bdi></p>}
            {d.closure&&<p>معيار الإغلاق: {d.closure}</p>}{d.history.map((h,i)=><p key={i}>{date(h.at)} — {h.text}{h.sourceRef&&<> · <bdi>{h.sourceRef}</bdi></>}</p>)}
            {!d.history.length&&<p>لم يُرفق سجل تغير لهذه اللقطة؛ لا يُفترض عدم وجود تاريخ سابق.</p>}
          </div>
        </details>)}</div>
        {!decisions.length&&<div className="sw-executive__empty"><h3>لا توجد حالات ضمن الفلاتر المختارة.</h3><p>لم تتغير القرارات المحفوظة. جرّب إزالة التصفية.</p><button type="button" onClick={()=>{reset();resetRef.current?.focus();}}>عرض كل الحالات</button></div>}
      </>}
      {tab==='weekly'&&<section className="sw-executive__weekly"><span className="sw-executive__pill">{report.weekly.status==='included'?'أسبوعية مرفقة':report.weekly.status==='unavailable'?'غير متاحة':'غير مستحقة'}</span>
        <h3>{report.weekly.status==='included'?'المراجعة الأسبوعية المرفقة':report.weekly.status==='unavailable'?'المراجعة الأسبوعية غير متاحة':'الأسبوعية غير مستحقة لهذا التاريخ'}</h3><p>{report.weekly.text}</p>
        {report.weekly.from&&<p>الفترة: <bdi>{report.weekly.from} — {report.weekly.to}</bdi></p>}
        {report.weekly.details.map((d,i)=><details key={i}><summary>{d.title}</summary><p>{d.text}</p>{d.sourceRef&&<bdi>{d.sourceRef}</bdi>}</details>)}
      </section>}
    </section>
    <details className="sw-executive__provenance"><summary>المصدر وحدود اللقطة</summary><p>{report.historicalIntegrity}</p><p>المصدر: <bdi>{report.provenance.sourceRef}</bdi> · مراجعة المحتوى: الرئيس التنفيذي0 · {date(report.provenance.sourceCutRiyadh)}</p><p>عرض إداري فقط؛ لا قبض أو صرف أو ترحيل أو تكليف أفراد من هذه الصفحة.</p></details>
  </article></LanguageContext.Provider>;
}

export function ExecutiveReportsAdmin({useQuery=useExecutiveReportQuery,request=requestExecutiveReport,DailySummary=ExecutiveDailySummaryLive}){
  const [viewTab,setViewTab]=useState('daily');
  const [refresh,setRefresh]=useState(0),[before,setBefore]=useState(null),[selected,setSelected]=useState(null),[revision,setRevision]=useState(null);
  const [firstPageDate,setFirstPageDate]=useState(null);
  const archive=useQuery({action:'list',...(before?{before}:{})},refresh);
  const latestReportDate=before?firstPageDate:archive.data?.items[0]?.dateRiyadh;
  const reportId=selected||archive.data?.items[0]?.reportId;
  const source=useQuery(reportId?{action:'read',reportId,...(revision?{revision}:{})}:null,refresh);
  const [draft,setDraft]=useState(null),[issue,setIssue]=useState(null),[receipt,setReceipt]=useState(null),[saving,setSaving]=useState(false);
  const [uncertain,setUncertain]=useState(null);
  const fileSequence=useRef(0),mounted=useRef(true),saveController=useRef(null);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;saveController.current?.abort();};},[]);
  // File text is treated as data, never executed, uploaded, or persisted until Save.
  async function chooseFile(event){
    const sequence=++fileSequence.current,file=event.target.files?.[0];setDraft(null);setIssue(null);setReceipt(null);
    if(!file)return;
    try{if(file.size>64000)throw new Error('الملف يتجاوز 64KB.');const value=parseExecutiveReport(JSON.parse(await file.text()));
      if(sequence===fileSequence.current&&mounted.current)setDraft(value);
    }catch(error){if(sequence===fileSequence.current&&mounted.current)setIssue(error instanceof SyntaxError?'ملف JSON غير صالح. اختر ملف تقرير صحيحًا.':error.message);}
  }
  async function save(){if(!draft||saving||uncertain)return;setSaving(true);setIssue(null);setReceipt(null);
    const controller=new AbortController();saveController.current=controller;
    const timer=setTimeout(()=>controller.abort(),30000);
    try{const result=await request({action:'save',report:draft,expectedRevision:draft.revision-1},controller.signal);
      if(result.reportId!==draft.reportId||result.revision!==draft.revision||typeof result.duplicate!=='boolean')throw new Error('نتيجة الحفظ غير مؤكدة.');
      if(!mounted.current)return;setReceipt(result);setSelected(result.reportId);setRevision(result.revision);setBefore(null);setRefresh(x=>x+1);setDraft(null);
    }catch(error){if(mounted.current){setIssue(error.name==='AbortError'?'انتهت مهلة الحفظ؛ النتيجة غير مؤكدة. اقرأ النسخة قبل إعادة المحاولة.':error.message);setUncertain(draft.reportId);}}
    finally{clearTimeout(timer);saveController.current=null;if(mounted.current)setSaving(false);}
  }
  async function verifyBeforeRetry(){if(!uncertain||saving)return;setSaving(true);
    const controller=new AbortController();saveController.current=controller;
    const timer=setTimeout(()=>controller.abort(),30000);
    try{await request({action:'read',reportId:uncertain},controller.signal);
      if(mounted.current){setSelected(uncertain);setRevision(null);setBefore(null);setRefresh(x=>x+1);setUncertain(null);setIssue('اكتملت القراءة. راجع النسخة الظاهرة قبل أي حفظ يدوي؛ لم يُعد إرسال الحفظ.');}}
    catch{if(mounted.current)setIssue('تعذّر التحقق من نتيجة الحفظ؛ تبقى إعادة الحفظ ممنوعة حتى تنجح القراءة.');}
    finally{clearTimeout(timer);saveController.current=null;if(mounted.current)setSaving(false);}
  }
  return <main className="sw-executive-page">
    <section className="sw-executive__toolbar"><label>تاريخ التقرير<select aria-label="أرشيف التقارير" value={reportId||''} onChange={e=>{setSelected(e.target.value);setRevision(null);}} disabled={!archive.data?.items.length}>
      {!archive.data?.items.length&&<option value="">لا تقرير مختار</option>}{archive.data?.items.map(r=><option key={r.reportId} value={r.reportId}>{r.dateRiyadh}</option>)}</select></label>
      <button type="button" onClick={()=>{setBefore(null);setSelected(null);setRevision(null);setRefresh(x=>x+1);}}>آخر التقارير</button>
      {before&&<p>تعرض صفحة أقدم من الأرشيف؛ ليست أحدث التقارير.</p>}
    </section>
    {(archive.loading||source.loading)&&<p role="status">جارٍ قراءة التقرير المختار…</p>}
    {(archive.error||source.error)&&<p role="alert">{archive.error||source.error}</p>}
    {!archive.loading&&!archive.error&&archive.data?.items.length===0&&<p>لا تقارير محفوظة في صفحة الأرشيف هذه.</p>}
    {source.data&&source.data.report===null&&<p>لم توجد نسخة محفوظة لهذا المعرف؛ لم تُنشأ بيانات بديلة.</p>}
    {source.data?.report&&<ExecutiveReportView key={`${reportId}|${source.data.report.revision}`} report={source.data.report} currentRevision={source.data.currentRevision} selectedTab={viewTab} onTabChange={setViewTab}
      dailySummary={<DailySummary report={source.data.report} latestReportDate={latestReportDate}/>}/>}
    {!archive.loading&&!source.loading&&!source.data?.report&&viewTab==='daily'&&<DailySummary report={null}/>}
    <details className="sw-executive__archive"><summary>النسخ وإدارة الأرشيف</summary>
      {archive.data?.nextBefore&&<button type="button" onClick={()=>{if(!before)setFirstPageDate(archive.data.items[0]?.dateRiyadh);setBefore(archive.data.nextBefore);setSelected(null);setRevision(null);}}>تقارير أقدم</button>}
      {source.data?.report&&<><label className="sw-executive__revision">نسخة التقرير<select value={source.data.report.revision} onChange={e=>setRevision(Number(e.target.value))}>
      {!source.data.history.some(h=>h.revision===source.data.report.revision)&&<option value={source.data.report.revision}>نسخة {number(source.data.report.revision)} — قديمة</option>}
      {source.data.history.map(h=><option key={h.revision} value={h.revision}>نسخة {number(h.revision)} — {h.reason}</option>)}</select></label>
      {source.data.historyLimited&&<p>تظهر آخر30نسخة فقط؛ الأقدم غير معروض في هذه القائمة.</p>}
      </>}
    </details>
    <details className="sw-executive__upload"><summary>إدخال تقرير إداري مراجع — للأدمن</summary><p>اختر ملف JSON مراجعًا من الرئيس التنفيذي0. لا يُحفظ بمجرد اختياره؛ راجع المعاينة ثم احفظ. المعرف اليومي ثابت والتصحيح لا يستبدل النسخة السابقة.</p>
      <label>ملف التقرير<input type="file" accept="application/json,.json" onChange={chooseFile} disabled={saving}/></label>
      {issue&&<p role="alert">{issue}</p>}{receipt&&<p role="status">{receipt.duplicate?'النسخة محفوظة مسبقًا دون تكرار.':'حُفظت النسخة.'} المرجع: <bdi>{receipt.reportId}</bdi> · نسخة {number(receipt.revision)}. تحقق من قراءتها بعد إعادة تحميل صريحة قبل اعتبار التسليم مكتملًا.</p>}
      {uncertain&&<button type="button" disabled={saving} onClick={verifyBeforeRetry}>قراءة النسخة قبل إعادة الحفظ</button>}
      {draft&&<><p className="sw-executive__warning">معاينة غير محفوظة — راجع التاريخ والمحتوى قبل الحفظ.</p><ExecutiveReportView key={`draft-${draft.reportId}-${draft.revision}`} report={draft}/><button type="button" disabled={saving||Boolean(uncertain||archive.error||source.error)||archive.loading||source.loading||!archive.data} onClick={save}>{saving?'جارٍ الحفظ…':'حفظ التقرير الإداري'}</button>{(archive.error||source.error)&&<p>يلزم نجاح قراءة الأرشيف قبل محاولة الحفظ؛ لا تعاود الحفظ أثناء عائق القراءة.</p>}</>}
    </details>
  </main>;
}

export default function ExecutiveReportsPage(){
  const {session}=useAuth(),{role,isPartnerView}=usePartnerView();
  const allowed=role==='admin'&&!isPartnerView&&Boolean(session?.user?.id);
  return <><TopBar wrapTitle title="التقارير التنفيذية" subtitle="خلاصة المشروع والقرارات المطلوبة"/>
    {allowed?<ExecutiveReportsAdmin key={`${session.user.id}|${role}|${isPartnerView}`} request={(input,signal)=>requestExecutiveReport(input,signal,session.user.id)}/>:<p>هذه الصفحة للأدمن فقط.</p>}</>;
}
