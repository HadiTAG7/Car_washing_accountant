import { useRef, useState } from 'react';
import { callBikerQuality } from '../lib/bikerQualityApi';

const stageNames = { arrival: ['الوصول', 'Arrival'], start: ['بدء الغسيل', 'Wash start'], end: ['إنهاء الغسيل', 'Wash end'] };
export default function BikerQualityManual({ manual, language, onReload }) {
  const text = (ar, en) => language === 'en' ? en : ar;
  const [washId, setWashId] = useState('');
  const [stages, setStages] = useState([]);
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [correctionReason, setCorrectionReason] = useState('');
  const [reviewChoice, setReviewChoice] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const retry = useRef(null);
  const available = manual?.policy === 'manual-status-20261015-v1' && manual.sourceAvailable;
  const timestamp = value => new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'ar-SA', {
    dateStyle: 'medium', timeStyle: 'short', calendar: 'gregory', timeZone: 'Asia/Riyadh',
  }).format(new Date(value));
  const submit = async (operation, fields) => {
    if (saving || !available) return;
    setSaving(true); setFeedback(null);
    const data = { bikerUID: manual.bikerUID, periodKey: manual.periodKey, from: manual.from, to: manual.to, revision: manual.revision, ...fields };
    const signature = JSON.stringify({ operation, data });
    if (retry.current?.signature !== signature) retry.current = { signature, data: { ...data, requestId: crypto.randomUUID() } };
    try {
      await callBikerQuality(operation, retry.current.data);
      setFeedback({ success: true, message: text('حُفظت المراجعة اليدوية. أعد تأكيد النطاق بعد تعديل الملاحظات.', 'Manual review saved. Reconfirm coverage after changing notes.') });
      retry.current = null; setWashId(''); setStages([]); setNote(''); setEditing(false); setCorrectionReason(''); setReviewChoice('');
      try { await onReload(); }
      catch { setFeedback({ success: true, message: text('تم الحفظ؛ تعذّر تحديث العرض. أعد تحميل البروفايل قبل أي حفظ آخر.', 'Saved, but the view could not refresh. Reload the profile before another save.') }); }
    } catch (error) { setFeedback({ success: false, message: error.message }); }
    finally { setSaving(false); }
  };
  return <section className="sw-biker-quality-manual" aria-label={text('عدم تحديث الحالة — مراجعة يدوية', 'Missing status updates — manual review')}>
    {!available ? <p role="status">{text('تعذّر تحميل نطاق المراجعة اليدوية؛ لا توجد نقاط مؤكدة.', 'Manual review scope is unavailable; no points are confirmed.')}</p> : <>
      {(manual.unlinkedWashes > 0 || manual.unresolvedNotes > 0) && <p role="alert">{text('توجد غسلات بلا معرّف موعد أو ملاحظات تغيّر ربطها؛ لا يمكن تأكيد التغطية قبل مراجعتها.', 'Some washes lack an appointment ID or notes no longer match their links. Coverage cannot be confirmed until reviewed.')}</p>}
      <details open={editorOpen} onToggle={event => setEditorOpen(event.currentTarget.open)}><summary>{text('تسجيل عدم تحديث', 'Record a missing status update')}</summary>
        <form onSubmit={event => { event.preventDefault(); submit(editing ? 'manual-correct' : 'manual-note', { washId, stages, note, ...(editing ? { correctionReason } : {}) }); }}>
          <label>{text('الغسلة المرتبطة بالعامل والفترة', 'Wash linked to this worker and period')}
            <select aria-label={text('الغسلة المرتبطة بالعامل والفترة', 'Wash linked to this worker and period')} value={washId} disabled={saving || editing} required onChange={event => setWashId(event.target.value)}>
              <option value="">{text('اختر الغسلة', 'Select a wash')}</option>
              {manual.eligible.filter(w => w.sspBookingId).map(w => <option key={w.washId} value={w.washId}>
                {w.sspBookingId} · {w.serviceDate} · {w.washId}
              </option>)}
            </select></label>
          <fieldset disabled={saving}><legend>{text('المراحل التي لم تُحدّث', 'Stages not updated')}</legend>
            {Object.entries(stageNames).map(([key, names]) => <label key={key}><input type="checkbox" checked={stages.includes(key)}
              onChange={event => setStages(current => event.target.checked ? [...current, key] : current.filter(k => k !== key))} />{text(...names)}</label>)}
          </fieldset>
          <label>{text('ملاحظة اختيارية', 'Optional note')}<textarea value={note} maxLength={1000} disabled={saving} onChange={event => setNote(event.target.value)} /></label>
          {editing && <label>{text('سبب التصحيح — إلغاء جميع المراحل يسحب الملاحظة مع إبقاء التدقيق', 'Correction reason — clearing all stages withdraws the note with an audit trail')}
            <input value={correctionReason} maxLength={500} required disabled={saving} onChange={event => setCorrectionReason(event.target.value)} /></label>}
          <button type="submit" className="sw-button sw-button--primary" disabled={saving || !washId || (!editing && !stages.length)}>
            {saving ? text('جارٍ الحفظ…', 'Saving…') : editing ? text('حفظ التصحيح المدقق', 'Save audited correction') : text('حفظ ملاحظة عدم التحديث', 'Save missing-update note')}</button>
          {editing && <button type="button" className="sw-button sw-button--secondary" disabled={saving} onClick={() => { setEditing(false); setWashId(''); setStages([]); setNote(''); }}>{text('إلغاء التصحيح', 'Cancel correction')}</button>}
        </form>
      </details>
      <h4>{text('الملاحظات اليدوية المحفوظة', 'Saved manual notes')}</h4>
      {!manual.notes.length && <p>{text('لا توجد ملاحظات مدخلة؛ هذا لا يعني تأكيد عدم وجود حالات.', 'No notes have been entered; this does not confirm zero cases.')}</p>}
      <ul>{manual.notes.map(n => <li key={n.washId}><bdi dir="ltr">{n.appointmentId} · {n.serviceDate}</bdi>{' · '}
        {n.stages.length ? n.stages.map(k => text(...stageNames[k])).join('، ') : text('مسحوبة بتصحيح مدقق', 'Withdrawn by audited correction')}
        <p dir="auto" translate="no">{n.note}</p><small>{text('مصدر يدوي — الأدمن', 'Manual source — admin')} · {timestamp(n.at)}</small>
        <details><summary>{text('تصحيح الملاحظة', 'Correct this note')}</summary><button type="button" className="sw-button sw-button--secondary" disabled={saving}
          onClick={() => { setEditorOpen(true); setEditing(true); setWashId(n.washId); setStages(n.stages); setNote(n.note); setCorrectionReason(''); }}>
          {text('تحميل الملاحظة في نموذج التصحيح أعلاه', 'Load this note into the correction form above')}</button></details>
      </li>)}</ul>
      <form onSubmit={event => { event.preventDefault(); submit('manual-confirm', { acknowledged: true, noCases: reviewChoice === 'zero', cohortHash: manual.cohortHash }); }}>
        <fieldset disabled={saving || !manual.eligible.length}><legend>{text('تأكيد مراجعة نطاق الفترة', 'Confirm review of the period scope')}</legend>
          <label><input type="radio" name="manual-review-choice" value="cases" checked={reviewChoice === 'cases'} onChange={() => setReviewChoice('cases')} disabled={!manual.notes.some(n => n.stages.length)} />{text('راجعت النطاق والحالات اليدوية المسجلة', 'I reviewed the scope and the recorded manual cases')}</label>
          <label><input type="radio" name="manual-review-choice" value="zero" checked={reviewChoice === 'zero'} onChange={() => setReviewChoice('zero')} disabled={manual.notes.some(n => n.stages.length)} />{text('راجعت النطاق وأؤكد عدم وجود حالات عدم تحديث', 'I reviewed the scope and explicitly confirm no missing-update cases')}</label>
        </fieldset>
        <button type="submit" className="sw-button sw-button--primary" disabled={saving || !reviewChoice || !manual.eligible.length || manual.unlinkedWashes > 0 || manual.unresolvedNotes > 0}>{text('تأكيد المراجعة اليدوية', 'Confirm manual review')}</button>
      </form>
      {manual.confirmation && <p>{text('آخر تأكيد يدوي', 'Last manual confirmation')}: {timestamp(manual.confirmation.at)}{!manual.confirmed && ` · ${text('يحتاج إعادة مراجعة النطاق أو الملاحظات', 'Scope or notes require another review')}`}</p>}
      <details><summary>{text('سجل تدقيق المراجعة اليدوية', 'Manual review audit trail')}</summary><ul>{manual.history.map(e => <li key={e.requestId}>
        {timestamp(e.at)} · <bdi dir="ltr">{e.operation}</bdi>{e.after && <> · <bdi dir="ltr">{e.after.appointmentId}</bdi></>}
        {e.correctionReason && <p dir="auto" translate="no">{e.correctionReason}</p>}
      </li>)}</ul></details>
    </>}
    {feedback && <p role={feedback.success ? 'status' : 'alert'}>{feedback.message}</p>}
  </section>;
}
