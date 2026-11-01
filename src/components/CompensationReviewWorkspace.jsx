import { useEffect, useRef, useState } from 'react';
import { Card } from './UI';
import { sourceSchema, safeReviewUrl, reviewStatusLabels, submissionLabels, reviewRecordEqual, TICKET_REVIEW_ARCHIVE_STATES } from '../lib/compensationReview';
import { useLanguage } from '../i18n/useLanguage';
import './CompensationReviewPage.css';
export function CompensationReviewWorkspace({ read, call }) {
  const { language } = useLanguage() || {}, tr = (ar,en) => language === 'en' ? en : ar;
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [uncertain, setUncertain] = useState(false);
  const [filter, setFilter] = useState('queue'), [search, setSearch] = useState(''), [page, setPage] = useState(0);
  const [bundle, setBundle] = useState(''), [preview, setPreview] = useState(null), [receiptId, setReceiptId] = useState('');
  const [pendingAction, setPendingAction] = useState(null), [actionText, setActionText] = useState('');
  const [viewTicketId, setViewTicketId] = useState(null);
  const confirmRef = useRef(null);
  const rootRef = useRef(null);
  const [returnFocusTo, setReturnFocusTo] = useState(null);
  useEffect(() => {
    if (pendingAction) { confirmRef.current?.scrollIntoView?.({ block:'center' }); confirmRef.current?.focus(); }
  }, [pendingAction]);
  const data = read.data, cases = data?.cases || [], queue = data?.queue;
  useEffect(() => {
    if (!returnFocusTo || pendingAction || read.loading || read.error || !data) return;
    const refreshed = data.cases.find(row => row.ticketId === returnFocusTo.ticketId);
    if (!refreshed || refreshed.revision < returnFocusTo.revision) return;
    const candidate = rootRef.current?.querySelector('[data-cr-action="' + returnFocusTo.action + '"][data-cr-ticket="' + returnFocusTo.ticketId + '"]');
    const target = candidate && !candidate.disabled ? candidate : rootRef.current?.querySelector('[data-cr-refresh]');
    target?.focus(); setReturnFocusTo(null);
  }, [returnFocusTo, pendingAction, read.loading, read.error, data]);
  const active = cases.find(r => r.ticketId === (viewTicketId || queue?.activeTicketId));
  const isActive = active?.ticketId === queue?.activeTicketId;
  const locked = busy || uncertain || read.loading || Boolean(read.error) || !data;
  const stamp = value => value ? new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'ar-SA', { dateStyle:'medium', timeStyle:'short', timeZone:'Asia/Riyadh', calendar:'gregory' }).format(new Date(value)) : tr('غير محفوظ','Not recorded');
  const status = row => language !== 'en' ? reviewStatusLabels[row.reviewStatus] || row.reviewStatus
    : ({ pending:'Awaiting Hadi', deferred:'Deferred without decision', left:'Left by Hadi', information_requested:'Information requested', historical_excluded:'October exclusions', prior_decision_unverified:'Unverified prior decision', previously_objected:'Previously objected', historical_deferred:'Historically deferred without a leave decision' })[row.reviewStatus] || row.reviewStatus;
  const submitStatus = row => language !== 'en' ? submissionLabels[row.submission?.status]
    : ({ none:'No submission request',draft:'Unsent draft',queued:'Request queued for the local agent',in_progress_uncertain:'Agent read the request; submission unconfirmed',sent:'Submitted with an OBJ receipt' })[row.submission?.status];
  async function mutate(op, payload) {
    if (locked) return;
    setBusy(true); setMessage('');
    try {
      const result = await call({ op, data: { ...payload, requestId: crypto.randomUUID() } });
      const reread = await call({ op: 'read' }), record = reread.cases.find(r => r.ticketId === result.record.ticketId);
      if (!record || record.revision !== result.record.revision || record.sourceHash !== result.record.sourceHash
        || !reviewRecordEqual(record, result.record))
        throw Error(tr('الحفظ غير محسوم؛ أعد القراءة ولا تكرر الطلب.','Save is unconfirmed. Re-read before retrying.'));
      setMessage(tr('حُفظ السجل وطابقته إعادة القراءة.','Saved and verified by re-reading.'));
      if (op === 'owner') setReturnFocusTo({ action:payload.action, ticketId:payload.ticketId, revision:result.record.revision });
      setPendingAction(null); setPreview(null); read.refresh();
      if (payload.action === 'next' || payload.action === 'select') setViewTicketId(null);
    } catch(e) { setUncertain(true); setMessage(e.message); }
    finally { setBusy(false); }
  }
  function owner(action, row = active) {
    setReturnFocusTo(null);
    setActionText(action === 'draft' || action === 'request_submission' ? row.draft.text : '');
    setPendingAction({ action, row });
  }
  const filtered = cases.filter(r => (filter === 'all' || (filter === 'archive'
    ? TICKET_REVIEW_ARCHIVE_STATES.includes(r.reviewStatus)
    : !TICKET_REVIEW_ARCHIVE_STATES.includes(r.reviewStatus)))
    && [r.ticketId,...r.source.facts.washIds,r.source.facts.biker.name,r.source.facts.biker.externalId,r.source.facts.complaint].join(' ').toLowerCase().includes(search.toLowerCase()));
  const visible = filtered.slice(page * 15, page * 15 + 15);
  const refresh = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const fresh = await call({ op:'read' });
      if (!Array.isArray(fresh?.cases) || !Number.isSafeInteger(fresh?.queue?.revision)) throw Error(tr('الحفظ غير محسوم؛ أعد القراءة ولا تكرر الطلب.','Save is unconfirmed. Re-read before retrying.'));
      setUncertain(false); setMessage(''); setPendingAction(null); read.refresh();
    } catch (e) { setUncertain(true); setMessage(e.message); }
    finally { setBusy(false); }
  };
  if (!read.allowed) return <main className="cr-page"><Card><p role="alert">{tr('هذه الصفحة للمدير فقط، ولا تظهر في معاينة الشريك.','This page is restricted to administrators and is unavailable in partner preview.')}</p></Card></main>;
  return <main ref={rootRef} className="cr-page" aria-label={tr('مراجعة التعويضات والاعتراضات','Compensation ticket review')}>
    <header className="cr-row"><h1>{tr('مراجعة التكتات','Ticket review')}</h1><button data-cr-refresh className="cr-button" onClick={refresh} disabled={busy}>{tr('تحديث السجل','Refresh records')}</button></header>
    <p className="cr-notice">{tr('لا يرسل الموقع اعتراضًا. طلب الرفع ينتظر قراءة الوكيل المحلي، ولا يوجد إيقاظ فوري مثبت.','The website does not submit objections. Requests wait for the local agent; instant wakeup is not available.')}</p>
    <small>{tr('الأعداد من السجلات المحفوظة هنا؛ نطاق المصدر وحدوده موضحان مع كل حالة.','Counts reflect records saved here; each case states its source coverage and limitations.')}</small>
    <p role={uncertain || read.error ? 'alert' : 'status'}>{message || read.error || (read.loading ? tr('جارٍ قراءة السجل…','Loading records…') : '')}</p>
    {data && <>
      <div className="cr-summary">
        {[[tr('في الطابور','In queue'),cases.filter(r=>r.reviewStatus==='pending').length],
          [tr('اعترض عليها سابقًا','Previously objected'),cases.filter(r=>r.objectionHistory?.length).length],
          [tr('طلبات رفع تنتظر','Queued requests'),cases.filter(r=>r.submission.status==='queued').length],
          [tr('الأرشيف والاستثناءات','Archive and exclusions'),cases.filter(r=>TICKET_REVIEW_ARCHIVE_STATES.includes(r.reviewStatus)).length]]
          .map(([label,n])=><Card key={label}><h2>{label}</h2><strong>{n}</strong></Card>)}
      </div>
      {active ? <Card className="cr-case" key={active.ticketId + ':' + active.revision}>
        <div className="cr-row"><h2>{isActive ? tr('الحالة النشطة · تكت','Active case · ticket') : tr('عرض السجل · تكت','Record details · ticket')} <bdi>{active.ticketId}</bdi></h2><span>{status(active)}</span></div>
        <p>{tr('حجوزات مرتبطة','Linked bookings')}: <bdi>{active.source.facts.washIds.join(' · ') || tr('غير متاحة','Unavailable')}</bdi> · {tr('البايكر','Biker')}: {active.source.facts.biker.name || '—'} <bdi>{active.source.facts.biker.externalId || ''}</bdi></p>
        <p>{tr('مصدر ربط البايكر','Biker identity evidence')}: {active.source.facts.biker.linkEvidence || '—'}</p>
        <p>{tr('تاريخ إنشاء التكت','Ticket creation date')}: <bdi>{active.source.facts.createdAt || '—'}</bdi> · {tr('آخر تحديث للتكت','Ticket last updated')}: <bdi>{active.source.facts.updatedAt || '—'}</bdi> · {tr('تاريخ الخدمة','Service date')}: <bdi>{active.source.facts.serviceDate || '—'}</bdi></p>
        <p>{tr('وقت قراءة SSP','SSP read time')}: {stamp(active.source.source.readAt)} · {tr('وقت تحديث الموقع','Website update time')}: {stamp(active.updatedAtIso)}</p>
        <p>{tr('آخر قراءة الوكيل للطلب','Agent last processed this request')}: {stamp(active.lastWorkerReadAt)}</p>
        <p className="cr-state">{submitStatus(active)} {active.submission.objectionId && <bdi>{active.submission.objectionId}</bdi>}</p>
        <details open><summary>{tr('المصدر والتغطية','Source and coverage')}</summary>
          <SafeLink href={active.source.source.url}>{tr('فتح المصدر المخول','Open authorized source')}</SafeLink>
          <p>{tr('التغطية','Coverage')}: {active.source.source.coverage.complete ? tr('مكتملة حسب المصدر','Complete as reported') : tr('جزئية','Partial')} · {active.source.source.coverage.filters}</p>
          <p><bdi>{active.source.source.coverage.from || '—'}</bdi> — <bdi>{active.source.source.coverage.to || '—'}</bdi></p>
          <p>{tr('الصفحات','Pages')}: {active.source.source.coverage.pages.join(' · ') || '—'}</p>
          <p>{tr('آخر نطاق مكتمل','Last completed coverage')}: {stamp(active.source.source.coverage.lastCompleteThrough)}</p>
          <TextList items={active.source.source.coverage.limitations} />
        </details>
        <h3>{tr('الشكوى ورد الدعم','Complaint and support response')}</h3><p className="cr-prose">{active.source.facts.complaint || '—'}</p><p className="cr-prose">{active.source.facts.supportResponse || '—'}</p><TextList items={active.source.facts.comments}/>
        <div className="cr-scroll"><table><caption>{tr('المبالغ مستقلة؛ المفقود ليس صفرًا','Separate amounts; missing does not mean zero')}</caption><thead><tr><th>{tr('البند','Item')}</th><th>{tr('القيمة والوحدة','Value and unit')}</th><th>{tr('الدليل','Evidence')}</th></tr></thead><tbody>
          {active.source.amounts.map((a,i)=><tr key={i}><th>{({customer_code:tr('كود العميل','Customer code'),compensation:tr('قسم التعويضات','Compensations'),invoice_deduction:tr('خصم فاتورة الغسلة','Wash invoice deduction'),settlement:tr('التسوية','Settlement'),late:tr('تأخير بالدقائق — مستبعد من الخصم','Lateness in minutes — excluded from deductions')})[a.kind]}</th><td>{a.value ?? tr('غير متاح','Unavailable')} {a.unit}</td><td>{a.sourceRef}</td></tr>)}
        </tbody></table></div>
        <h3>{tr('المرفقات ومراجعتها','Attachments and evidence review')}</h3>
        {!active.source.attachments.length && <p>{tr('لا توجد مرفقات في الحزمة؛ لا يعني ذلك مشاهدتها.','No attachments in this package; no viewing is implied.')}</p>}
        <div className="cr-attachments">{active.source.attachments.map(a=><article key={a.id}><strong>{a.kind} · {a.id}</strong><p>{({viewed:tr('فُتح وشوهد','Opened and viewed'),unavailable:tr('تعذر العرض','Could not view'),missing:tr('مفقود','Missing'),duplicate:tr('مكرر','Duplicate')})[a.observation]}</p><p>{a.note}</p>{a.url && <SafeLink href={a.url}>{tr('فتح المرفق في مصدره الخاص','Open attachment at its private source')}</SafeLink>}</article>)}</div>
        <div className="cr-scroll"><table><caption>{tr('الأوقات كما أثبتها المصدر','Times as evidenced by the source')}</caption><thead><tr>{[tr('الحدث','Event'),tr('الوقت','Time'),tr('المنطقة والدقة','Timezone and precision'),tr('المرجع','Reference')].map(t=><th key={t}>{t}</th>)}</tr></thead><tbody>{active.source.timeline.map((t,i)=><tr key={i}><th>{t.label}</th><td><bdi>{t.value || tr('غير متاح','Unavailable')}</bdi></td><td>{t.timezone || tr('غير مثبتة','Unconfirmed')} · {t.precision}</td><td>{t.sourceRef}</td></tr>)}</tbody></table></div>
        <h3>{tr('ما يثبته الدليل','Evidence supports')}</h3><TextList items={active.source.analysis.proven}/>
        <h3>{tr('القصور وما لا يثبته','Limitations')}</h3><TextList items={active.source.analysis.limitations}/>
        <h3>{tr('نقاط الاعتراض المحتملة','Potential objection points')}</h3><TextList items={active.source.analysis.objectionPoints}/>
        <h3>{tr('المسودة الحالية — غير مرسلة','Current draft — unsent')}</h3><p className="cr-prose">{active.draft.text || tr('لا توجد مسودة.','No draft.')}</p>
        <p>{tr('نسخة المسودة','Draft revision')}: {active.draft.revision} · {tr('نسخة السجل','Record revision')}: {active.revision}</p>
        <h3>{tr('كل اعتراضات SSP','All SSP objections')}</h3>
        {!active.objectionHistory?.length && <p>{tr('لم يظهر اعتراض في نطاق الفحص المسجل؛ ليس إثباتًا خارج التغطية.','No objection was found within the recorded coverage; this does not prove absence outside it.')}</p>}
        {active.objectionHistory?.map(o=><article className="cr-obj" key={o.id}><SafeLink href={o.url}>{o.id}</SafeLink> · {o.status}<p>{o.reply}</p><small>{tr('آخر فحص','Last checked')}: {stamp(o.checkedAt)}</small></article>)}
        <p className="cr-notice">{tr('Accepted في SSP لا يثبت استردادًا أو عكس خصم. لا يغيّر هذا السجل أي مالية.','An Accepted SSP objection does not establish a refund or reversal. This record changes no financial data.')}</p>
        {data.canDecide && isActive ? <div className="cr-actions">{[['leave',tr('تركها دون اعتراض','Leave without objection')],['information',tr('طلب معلومات','Request information')],['draft',tr('حفظ مسودة','Save draft')],['request_submission',tr('طلب رفع هذا التكت بالنص المحدد','Request submission of this ticket with the exact text')],['next',tr('التالي','Next case')]].map(([action,label])=>
          <button data-cr-action={action} data-cr-ticket={active.ticketId} className={'cr-button ' + (action==='request_submission'?'cr-primary':'')} key={action} disabled={locked || (action==='request_submission' && (!active.draft.text || active.objectionHistory?.length || ['queued','in_progress_uncertain','sent'].includes(active.submission.status)))} onClick={()=>owner(action)}>{label}</button>)}</div>
          : <p>{tr('قرارات هادي متاحة من جلسته المخولة فقط.','Only Hadi’s authorized session can record owner decisions.')}</p>}
        <details><summary>{tr('سجل القرارات والنسخ','Decision and revision history')}</summary>
          {active.decisions.map((d,i)=><article className="cr-obj" key={i}><strong>{d.action}</strong> · {stamp(d.at)}<p>{tr('الفاعل','Actor')}: <bdi>{d.actor}</bdi> · {tr('نسخة السجل','Record revision')}: {d.caseRevision} · {tr('نسخة المسودة','Draft revision')}: {d.draftRevision}</p><p className="cr-prose">{d.text}</p></article>)}
          <p>{tr('عدد قراءات المصدر السابقة','Previous source readings')}: {active.sourceHistory.length}</p>
          {active.sourceHistory.map((h,i)=><details key={i}><summary>{stamp(h.replacedAt)} · {tr('قراءة سابقة','Previous reading')}</summary><p className="cr-prose">{h.source.facts.complaint}</p><p>{h.source.facts.supportResponse}</p><p>{tr('بصمة المصدر','Source hash')}: <bdi>{h.sourceHash}</bdi></p></details>)}
          <h3>{tr('سجل فحوص المصدر','Source check log')}</h3>
          {(active.sourceChecks || []).map((c,i)=><p key={i}>{stamp(c.readAt)} · {c.coverage.complete ? tr('مكتمل','Complete'):tr('جزئي','Partial')} · {c.coverage.pages.join(' · ')} · <bdi>{c.actor}</bdi></p>)}
        </details>
        {['queued','in_progress_uncertain'].includes(active.submission.status) && <details><summary>{tr('للوكيل: قراءة الطلب وإيصال التنفيذ الفعلي','Agent: acknowledge request and record actual receipt')}</summary><p>{tr('لا يرسل أي زر هنا إلى SSP. سجّل الإيصال فقط بعد ظهوره وقراءته في المصدر.','No button here sends to SSP. Record the receipt only after it appears and is read in the source.')}</p>
          <button className="cr-button" disabled={locked} onClick={()=>mutate('execution',{ticketId:active.ticketId,expectedRevision:active.revision,submissionRequestId:active.submission.requestId,action:'observed',objectionId:null})}>{tr('سجل أن الوكيل قرأ الطلب','Record that the agent read the request')}</button>
          <label>{tr('رقم OBJ المقروء بعد الطلب','OBJ number read after the request')}<input value={receiptId} onChange={e=>setReceiptId(e.target.value)} dir="ltr"/></label>
          <button className="cr-button" disabled={locked || !receiptId} onClick={()=>mutate('execution',{ticketId:active.ticketId,expectedRevision:active.revision,submissionRequestId:active.submission.requestId,action:'receipt',objectionId:receiptId})}>{tr('حفظ إيصال OBJ المثبت','Save evidenced OBJ receipt')}</button>
        </details>}
      </Card> : <Card><h2>{tr('لا توجد حالة نشطة','No active case')}</h2><p>{tr('افتح حالة من الطابور للمراجعة؛ التالي لا يعني ترك الحالة السابقة.','Open a case from the queue. Next does not mean leaving the previous case.')}</p></Card>}
      {pendingAction && <section ref={confirmRef} tabIndex={-1} className="cr-confirm"><Card><form onSubmit={e=>{e.preventDefault(); if (pendingAction.action==='request_submission' && actionText!==pendingAction.row.draft.text) return;
        void mutate('owner',{ticketId:pendingAction.row.ticketId,expectedRevision:pendingAction.row.revision,expectedQueueRevision:queue.revision,action:pendingAction.action,text:actionText,confirmed:true});}}>
        <h2>{tr('تأكيد قرار هادي للتكت','Confirm Hadi’s decision for ticket')} <bdi>{pendingAction.row.ticketId}</bdi></h2>
        <p>{pendingAction.action==='reopen'?tr('إعادة مراجعة مستقلة تحفظ القرار القديم؛ ليست طلب إرسال. اكتب السبب.','This separate decision reopens review and preserves the original decision. It is not a submission request. Enter a reason.'):pendingAction.action==='next'?tr('ستنتقل للتالية؛ الحالة دون قرار تبقى مؤجلة.','Move to the next case; an undecided case remains deferred.'):pendingAction.action==='request_submission'?tr('يحفظ طلبًا لهذا النص والتكت فقط؛ لا يرسل اعتراضًا الآن.','Saves a request for this exact text and ticket; it does not submit now.'):tr('سيُحفظ الفاعل والوقت ونسخة السجل والنص.','The actor, time, record revision and text will be audited.')}</p>
        <label>{tr('نص القرار أو المسودة','Decision or draft text')}<textarea value={actionText} onChange={e=>setActionText(e.target.value)} required={['information','reopen'].includes(pendingAction.action)} readOnly={pendingAction.action==='request_submission'} maxLength={8000}/></label>
        <label className="cr-check"><input type="checkbox" required/>{tr('أؤكد هذا القرار للتكت المعروض','I confirm this decision for the displayed ticket')}</label>
        <button className="cr-button cr-primary" disabled={locked}>{tr('تأكيد وحفظ','Confirm and save')}</button><button type="button" className="cr-button" onClick={()=>{setReturnFocusTo({action:pendingAction.action,ticketId:pendingAction.row.ticketId,revision:pendingAction.row.revision});setPendingAction(null);}} disabled={busy}>{tr('إلغاء','Cancel')}</button>
      </form></Card></section>}
      <Card><div className="cr-row"><h2>{tr('الطابور والأرشيف','Queue and archive')}</h2><label>{tr('العرض','View')}<select value={filter} onChange={e=>{setFilter(e.target.value);setPage(0);}}><option value="queue">{tr('الطابور','Queue')}</option><option value="archive">{tr('الأرشيف والاستثناءات','Archive and exclusions')}</option><option value="all">{tr('الكل','All')}</option></select></label>
        <label>{tr('بحث في كل السجل','Search all records')}<input value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/></label></div>
        <div className="cr-scroll"><table><thead><tr>{[tr('التكت','Ticket'),tr('البايكر','Biker'),tr('الحالة','Status'),tr('مرجع التاريخ المستثنى','Historical reference'),tr('الاعتراضات','Objections'),tr('فتح','Open')].map(t=><th key={t}>{t}</th>)}</tr></thead><tbody>{visible.map(r=><tr key={r.ticketId}><th><bdi>{r.ticketId}</bdi></th><td>{r.source.facts.biker.name || '—'}</td><td>{status(r)}</td><td>{r.source.historicalReference || '—'}</td><td>{r.objectionHistory?.map(o=>o.id).join(' · ') || '—'}</td><td><button className="cr-button" onClick={()=>setViewTicketId(r.ticketId)}>{tr('عرض التفاصيل','View details')}</button>{data.canDecide && <button data-cr-ticket={r.ticketId} data-cr-action={["pending","deferred"].includes(r.reviewStatus)?"select":"reopen"} className="cr-button" disabled={locked || r.ticketId===queue.activeTicketId} onClick={()=>owner(['pending','deferred'].includes(r.reviewStatus)?'select':'reopen',r)}>{['pending','deferred'].includes(r.reviewStatus)?tr('تعيين كحالة نشطة','Set as active case'):tr('إعادة مراجعة بقرار هادي','Reopen by Hadi’s decision')}</button>}</td></tr>)}</tbody></table></div>
        {!visible.length && <p>{tr('لا توجد نتائج ضمن هذا الفلتر.','No results for this filter.')}</p>}
        <nav className="cr-row" aria-label={tr('صفحات السجل','Record pages')}><button className="cr-button" onClick={()=>setPage(p=>p-1)} disabled={!page}>{tr('السابق','Previous')}</button><span>{page+1} / {Math.max(1,Math.ceil(filtered.length/15))} · {filtered.length}</span><button className="cr-button" onClick={()=>setPage(p=>p+1)} disabled={(page+1)*15>=filtered.length}>{tr('التالي في السجل','Next records')}</button></nav>
      </Card>
      <details className="cr-import"><summary>{tr('للوكيل: تحديث حقائق المصدر والمسودة المقترحة','Agent: update source facts and proposed draft')}</summary>
        <p>{tr('حزمة مصدر خاصة فقط. لا تقبل قرارات هادي أو طلب رفع أو حالة إرسال. تحفظ المسودة المقترحة عند إنشاء الحالة فقط.','Private source package only. Owner decisions, submission requests and sent status are rejected. A proposed draft initializes new cases only.')}</p>
        <label>{tr('ملف JSON خاص','Private JSON file')}<input type="file" accept=".json,application/json" disabled={locked} onChange={async e=>{const file=e.target.files[0];if(file && file.size<=180000){setBundle(await file.text());setPreview(null);}}}/></label>
        <label>{tr('حزمة المصدر JSON','Source JSON package')}<textarea dir="ltr" value={bundle} maxLength={180000} onChange={e=>{setBundle(e.target.value);setPreview(null);}}/></label>
        <button className="cr-button" disabled={locked || !bundle} onClick={()=>{try{const s=sourceSchema.parse(JSON.parse(bundle));setPreview(s);setMessage('');}catch(e){setMessage(e.message);}}}>{tr('معاينة دون حفظ','Preview without saving')}</button>
        {preview && <section><h3>{tr('معاينة التكت','Ticket preview')} <bdi>{preview.ticketId}</bdi></h3><p>{preview.facts.complaint}</p><p>{preview.queueDisposition} · {preview.attachments.length} · {preview.objections.length}</p>
          <button className="cr-button cr-primary" disabled={locked} onClick={()=>mutate('source',{source:preview,expectedRevision:cases.find(r=>r.ticketId===preview.ticketId)?.revision || 0})}>{tr('حفظ حقائق المصدر ثم التحقق بالقراءة','Save source facts and verify by reading')}</button></section>}
      </details>
    </>}
  </main>;
}
function SafeLink({ href, children }) { return safeReviewUrl(href) ? <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{children}</a> : <span>{children} — رابط غير آمن</span>; }
function TextList({ items }) { return items?.length ? <ul>{items.map((t,i)=><li className="cr-prose" key={i}>{t}</li>)}</ul> : <p>—</p>; }







