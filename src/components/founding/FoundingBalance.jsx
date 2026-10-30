import { useState } from 'react';
import { ArrowLeftRight, FilePlus2, Landmark, Wallet } from 'lucide-react';
import { ConfirmButton, EntryLines, StatusBadge } from './FoundingCommon';
import { money, day, when, meaningText, TRANSFER_SOURCE as SOURCE } from '../../lib/founding/foundingFormat';
import { uploadInvoiceFile } from '../../lib/firebaseClient';

const KIND = { variable: 'متغيرة', monthly: 'شهرية', annual: 'سنوية', startup: 'تأسيس' };
const DIRECTIONS = {
  debit_2300: 'من رصيدي الجاري إلى تسويات التأسيس (مدين 2300 / دائن 3200)',
  credit_2300: 'من تسويات التأسيس إلى رصيدي الجاري (مدين 3200 / دائن 2300)',
};
const halalaOnly = value => Number(value) > 0 && Math.round(Number(value) * 100) === Number(value) * 100;
const newRequestId = () => (globalThis.crypto?.randomUUID?.() || `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, '').slice(0, 40);

/**
 * بدون كشف شخصي: رصيد حساب هادي الجاري 2300 مفصّلًا من المستندات وكشف
 * الشركة، وإقرار المدير عليه بملاحظة. لا يُقترح قيد فرق تلقائي على 3200.
 */
export function HadiBalance({ founding }) {
  const { plan } = founding.data, b = plan.hadiBalance;
  const [note, setNote] = useState('');
  const undecided = plan.groups.partners.filter(p => !p.arrival), unposted = undecided.filter(p => !p.protected);
  // The decisions first; then the unposted payments' records follow them (posted ones get correction entries to approve).
  async function allToHadi() {
    if (!await founding.act({ action: 'decidePayments', keys: undecided.map(p => p.key), arrival: 'hadi', confirm: true }, 'حُفظت جهة وصول الدفعات.')) return;
    for (let i = 0; i < unposted.length; i += 10) {
      await founding.call({ action: 'applyUpdates', keys: unposted.slice(i, i + 10).map(p => p.key), confirm: true }).catch(() => null);
    }
    if (unposted.length) founding.refresh();
  }
  const attestation = b.attestation;
  return <section className="fw-panel" aria-label="رصيد حسابك الجاري">
    <h2><Wallet size={18} /> رصيد حسابك الجاري 2300 — من المستندات وكشف الشركة</h2>
    <p>بدون كشف شخصي: الرصيد من المستندات التي دفعتها، ودفعات الشركاء التي وصلتك، وتحويلاتك من كشف حساب الشركة.
      لا يُقترح قيد فرق تلقائي على 3200؛ أي مبلغ ينتقل إليه بقيد تكتب سببه وتوافق عليه.</p>
    <div className="fw-table-scroll"><table>
      <tbody>
        <tr><th scope="row">مستندات دفعتها ({b.paidCount}){b.attestedCount ? ` — منها بإقرار المدير ${b.attestedCount} · ${money(b.attested)}` : ''}</th><td>{money(b.paid)}</td></tr>
        <tr><th scope="row">دفعات شركاء وصلتك ({b.receivedCount})</th><td>{money(-b.received)}</td></tr>
        <tr><th scope="row">تحويلاتك لحساب الشركة (من كشف الشركة أو بلا كشف)</th><td>{money(b.toCompany)}</td></tr>
        {b.toHadi > 0 && <tr><th scope="row">تحويلات من حساب الشركة لك</th><td>{money(-b.toHadi)}</td></tr>}
        <tr><th scope="row">الصافي</th><td><strong>{money(b.net)}</strong> · {meaningText(b.meaning)}</td></tr>
        {b.adjustments !== 0 && <tr><th scope="row">بعد التسويات على 3200</th><td><strong>{money(b.afterAdjustments)}</strong> · {meaningText(b.afterMeaning)}</td></tr>}
      </tbody>
    </table></div>
    {undecided.length > 0 && <div className="fw-warning" role="status">
      <span>دفعات شركاء في فترة التأسيس لم تُحسم وجهتها: {b.undecided.count} · {money(b.undecided.amount)}. لا تدخل الصافي حتى تُحسم (هنا كلها، أو كل دفعة في «د) دفعات الشركاء»).</span>
      <ConfirmButton label={`كلها وصلت لحسابي (${undecided.length})`} disabled={founding.busy}
        confirmText={`يحفظ أن ${undecided.length} دفعة مجموعها ${money(b.undecided.amount)} وصلت لحسابك الشخصي، باسمك ووقتك، ويعدّل جهة استلام غير المرحّلة منها (${unposted.length}). المرحّلة لها قيود تصحيح تنتظر موافقتك. لا ترحيل.`}
        onConfirm={allToHadi} />
    </div>}
    {b.transfers.length > 0 ? <details className="fw-form-section"><summary>التحويلات بينك وبين حساب الشركة ({b.transfers.length})</summary>
      <div className="fw-table-scroll"><table>
        <thead><tr><th>التاريخ</th><th>الوصف</th><th>الكشف</th><th>الاتجاه</th><th>المبلغ</th><th>القيد</th></tr></thead>
        <tbody>{b.transfers.map(t => <tr key={t.key}><td>{day(t.date)}</td><td>{t.title}</td><td>{SOURCE[t.account] || t.account}</td>
          <td>{t.toCompany ? 'منك لحساب الشركة' : 'من حساب الشركة لك'}</td><td>{money(t.amount)}</td><td><StatusBadge status={t.status} /></td></tr>)}</tbody>
      </table></div>
    </details> : <small>لا تحويلات معلّمة بعد. ارفع كشف حساب الشركة من «كشوف الحساب» وعلّم إيداعاتك «تحويل بين هادي والشركة».</small>}
    <h3>إقرار المدير على الرصيد</h3>
    {attestation && <p role="status" className={attestation.changed ? 'fw-warning' : 'fw-success'}>
      اعتمدت الرصيد {money(attestation.net)} — {attestation.byName}، <bdi>{when(attestation.atIso)}</bdi>. ملاحظتك: {attestation.note}
      {attestation.changed ? ` — تغيّر الرصيد بعدها (صار ${money(b.net)})؛ راجعه واعتمده من جديد.` : ''}</p>}
    {(!attestation || attestation.changed) && <>
      <div className="fw-form"><label className="fw-wide">ملاحظة الاعتماد<textarea rows={2} value={note} onChange={e => setNote(e.target.value)}
        placeholder="مثلًا: راجعت المستندات ودفعات الشركاء والتحويلات حتى تاريخه" /></label></div>
      <div className="fw-actions"><ConfirmButton primary label="اعتماد الرصيد بإقرار المدير" disabled={founding.busy || note.trim().length < 3}
        confirmText={`يحفظ أنك راجعت الرصيد ${money(b.net)} (${meaningText(b.meaning)}) بملاحظتك، باسمك ووقتك. لا قيد ولا ترحيل.`}
        onConfirm={async () => { if (await founding.act({ action: 'attestBalance', hash: b.hash, note: note.trim(), confirm: true }, 'اعتُمد الرصيد.')) setNote(''); }} /></div>
    </>}
  </section>;
}

/** تسويات 3200: مبلغ واتجاه وسبب يكتبه هادي ← قيد مقترح باسمه، يُرحّل بموافقته فقط. */
export function Adjustments({ founding, names }) {
  const { plan } = founding.data, list = plan.entries.filter(e => e.type === 'adjustment');
  const [form, setForm] = useState({ amount: '', direction: 'debit_2300', reason: '' });
  const set = patch => setForm(f => ({ ...f, ...patch }));
  const amount = Number(form.amount), ready = halalaOnly(form.amount) && form.reason.trim().length >= 5;
  const preview = halalaOnly(form.amount) ? (form.direction === 'debit_2300'
    ? [{ accountId: '2300', debit: amount, credit: 0, description: 'تسوية حساب هادي الجاري' }, { accountId: '3200', debit: 0, credit: amount, description: form.reason.trim() || '—' }]
    : [{ accountId: '3200', debit: amount, credit: 0, description: form.reason.trim() || '—' }, { accountId: '2300', debit: 0, credit: amount, description: 'تسوية حساب هادي الجاري' }]) : null;
  return <section className="fw-panel" aria-label="التسويات على 3200">
    <h2><Landmark size={18} /> التسويات على 3200 تسويات فترة التأسيس</h2>
    <p>لا يُقترح شيء هنا تلقائيًا. تكتب المبلغ والاتجاه والسبب، فيُحفظ قيدًا مقترحًا باسمك، ولا يُرحّل إلا بموافقتك من «قيود التصحيح والتسوية».</p>
    <small>مدين 2300 / دائن 3200: ينقص ما على المشروع لك، أو يزيد ما عندك للمشروع. والعكس بالعكس.</small>
    <div className="fw-form">
      <label>المبلغ<input type="number" min="0" step="0.01" value={form.amount} onChange={e => set({ amount: e.target.value })} /></label>
      <label className="fw-wide">الاتجاه<select value={form.direction} onChange={e => set({ direction: e.target.value })}>
        {Object.entries(DIRECTIONS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label className="fw-wide">السبب<input value={form.reason} onChange={e => set({ reason: e.target.value })} placeholder="مثلًا: مبالغ بلا مستندات تنازل عنها هادي للمشروع" /></label>
    </div>
    {preview && <EntryLines lines={preview} names={names} />}
    <div className="fw-actions"><ConfirmButton primary label="حفظ التسوية قيدًا مقترحًا" disabled={founding.busy || !ready}
      confirmText={`يحفظ قيدًا مقترحًا بـ ${money(amount || 0)} على 3200 بسببك، باسمك ووقتك. لا ترحيل.`}
      onConfirm={async () => { if (await founding.act({ action: 'proposeAdjustment', amount, direction: form.direction, reason: form.reason.trim(), confirm: true }, 'حُفظت التسوية مقترحة.')) setForm({ amount: '', direction: 'debit_2300', reason: '' }); }} /></div>
    {list.length > 0 && <ul className="founding-list">{list.map(e => <li key={e.key}>
      <strong>{e.reason}</strong> · {money(e.amount)} · {e.direction === 'debit_2300' ? 'مدين 2300 / دائن 3200' : 'مدين 3200 / دائن 2300'} <StatusBadge status={e.status} />
      {e.entryNumber ? <span> قيد رقم {e.entryNumber}</span> : null}
      <small> — {e.proposedByName}، <bdi>{when(e.proposedAtIso)}</bdi>{e.postedReason ? ` · سبب الموافقة: ${e.postedReason}` : ''}</small>
      {e.status !== 'posted' && <ConfirmButton label="حذف" disabled={founding.busy} confirmText="يحذف التسوية المقترحة. لا قيد."
        onConfirm={() => founding.act({ action: 'removeAdjustment', id: e.id, confirm: true }, 'حُذفت التسوية.')} />}
    </li>)}</ul>}
  </section>;
}

/** تحويل هادي لحساب الشركة بلا كشف: التاريخ والمبلغ والبيان والسبب ← قيد مقترح (مدين 1020 / دائن 2300). */
export function ManualTransfers({ founding, names }) {
  const { plan } = founding.data, list = plan.entries.filter(e => e.key.startsWith('manual_transfer:'));
  const blank = { date: '', amount: '', description: '', reason: '' };
  const [form, setForm] = useState(blank);
  const set = patch => setForm(f => ({ ...f, ...patch }));
  const amount = Number(form.amount);
  const ready = form.date && halalaOnly(form.amount) && form.description.trim().length >= 2 && form.reason.trim().length >= 5;
  return <section className="fw-panel" aria-label="تحويل لحساب الشركة بدون كشف">
    <h2><ArrowLeftRight size={18} /> تحويلك لحساب الشركة — بدون كشف</h2>
    <p>تحويل من حسابك لحساب الشركة ما له سطر في كشف مرفوع. يُحفظ قيدًا مقترحًا باسمك: مدين 1020 البنك، دائن 2300 حسابك الجاري، ويُحسب ضمن «تحويلاتك لحساب الشركة» مثل الإيداعات المعلّمة من الكشف. لا يُرحّل إلا بموافقتك من «قيود التصحيح والتسوية».</p>
    <div className="fw-form">
      <label>التاريخ<input type="date" value={form.date} onChange={e => set({ date: e.target.value })} /></label>
      <label>المبلغ<input type="number" min="0" step="0.01" value={form.amount} onChange={e => set({ amount: e.target.value })} /></label>
      <label className="fw-wide">البيان<input value={form.description} onChange={e => set({ description: e.target.value })} placeholder="مثلًا: حوالة من حسابي في الراجحي لحساب الشركة" /></label>
      <label className="fw-wide">السبب<input value={form.reason} onChange={e => set({ reason: e.target.value })} placeholder="مثلًا: ما رفعت كشف الشركة لهذا الشهر بعد" /></label>
    </div>
    {halalaOnly(form.amount) && <EntryLines names={names} lines={[{ accountId: '1020', debit: amount, credit: 0, description: `تحويل من هادي إلى حساب الشركة — ${form.description.trim() || '—'}` },
      { accountId: '2300', debit: 0, credit: amount, description: form.description.trim() || '—' }]} />}
    <div className="fw-actions"><ConfirmButton primary label="حفظ التحويل قيدًا مقترحًا" disabled={founding.busy || !ready}
      confirmText={`يحفظ قيدًا مقترحًا بـ ${money(amount || 0)} بتاريخ ${day(form.date)} بسببك، باسمك ووقتك. لا ترحيل.`}
      onConfirm={async () => { if (await founding.act({ action: 'proposeTransfer', date: form.date, amount, description: form.description.trim(), reason: form.reason.trim(), confirm: true },
        'حُفظ التحويل مقترحًا.')) setForm(blank); }} /></div>
    {list.length > 0 && <ul className="founding-list">{list.map(e => <li key={e.key}>
      <strong>{e.title}</strong> · {money(e.amount)} · {day(e.originalDate)}{e.date !== e.originalDate ? ` (يُقيَّد ${day(e.date)} — شهره مقفل)` : ''} <StatusBadge status={e.status} />
      {e.entryNumber ? <span> قيد رقم {e.entryNumber}</span> : null}
      <small> — السبب: {e.reason} · {e.proposedByName}، <bdi>{when(e.proposedAtIso)}</bdi>{e.postedReason ? ` · سبب الموافقة: ${e.postedReason}` : ''}</small>
      {e.possibleTwin && e.status !== 'posted' && <small className="founding-error">انتبه: في {e.possibleTwin.account === 'company' ? 'كشف الشركة' : 'كشفك'} تحويل بنفس المبلغ بتاريخ {day(e.possibleTwin.txDate)} — لا تحسبه مرتين.</small>}
      {e.status !== 'posted' && <ConfirmButton label="حذف" disabled={founding.busy} confirmText="يحذف التحويل المقترح. لا قيد."
        onConfirm={() => founding.act({ action: 'removeTransfer', id: e.id, confirm: true }, 'حُذف التحويل.')} />}
    </li>)}</ul>}
  </section>;
}

/** «مصروف تأسيس بإقرار المدير»: نموذج سريع لمصروف دفعته ولا مستند له، وقائمته. */
export function AttestedExpenses({ founding }) {
  const data = founding.data, plan = data.plan, options = data.expenseOptions || {};
  const closed = new Set(data.closedMonths || []), { cutoffDate, foundingEnd } = plan.settings;
  const blank = () => ({ requestId: newRequestId(), approxDate: '', amount: '', description: '', kind: 'startup', classificationId: '', note: '', file: null });
  const [form, setForm] = useState(blank), [uploading, setUploading] = useState(false), [fileError, setFileError] = useState('');
  const set = patch => setForm(f => ({ ...f, ...patch }));
  const recordDate = form.approxDate && closed.has(form.approxDate.slice(0, 7)) ? foundingEnd : form.approxDate;
  const late = form.approxDate && form.approxDate >= cutoffDate;
  const ready = form.approxDate && !late && halalaOnly(form.amount) && form.description.trim().length >= 2 && form.classificationId;
  const list = plan.attestedExpenses, total = list.reduce((n, e) => n + Number(e.amount), 0);
  async function save() {
    setFileError('');
    let proofUrl = null;
    if (form.file) {
      setUploading(true);
      try { proofUrl = await uploadInvoiceFile(form.file, 'founding-attestation'); }
      catch (error) { setFileError(error.message); setUploading(false); return; }
      setUploading(false);
    }
    const done = await founding.act({ action: 'attestExpense', requestId: form.requestId, approxDate: form.approxDate, amount: Number(form.amount),
      description: form.description.trim(), kind: form.kind, classificationId: form.classificationId, proofUrl, note: form.note.trim() || null, confirm: true },
    'سُجّل المصروف بإقرارك، بانتظار الاعتماد في صندوق العمل المالي.');
    if (done) setForm(blank());
  }
  const status = e => e.protected ? 'مرحّل' : e.approval === 'approved' ? 'معتمد' : 'بانتظار الاعتماد';
  return <section className="fw-panel" aria-label="مصاريف تأسيس بإقرار المدير">
    <h2><FilePlus2 size={18} /> مصروف تأسيس بإقرار المدير</h2>
    <p>لمصروف دفعته في فترة التأسيس ولا مستند له. يُسجّل باسمك عبر صندوق العمل المالي، بلا ضريبة مدخلات، حسابه المقابل 2300، ويعود «بانتظار الاعتماد». لا ترحيل.</p>
    <div className="fw-form">
      <label>التاريخ التقريبي<input type="date" max={foundingEnd} value={form.approxDate} onChange={e => set({ approxDate: e.target.value })} /></label>
      <label>المبلغ<input type="number" min="0" step="0.01" value={form.amount} onChange={e => set({ amount: e.target.value })} /></label>
      <label className="fw-wide">الوصف<input value={form.description} onChange={e => set({ description: e.target.value })} placeholder="مثلًا: أجرة نقل أغراض السكن" /></label>
      <label>النوع<select value={form.kind} onChange={e => set({ kind: e.target.value, classificationId: '' })}>
        {Object.entries(KIND).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>التصنيف<select value={form.classificationId} onChange={e => set({ classificationId: e.target.value })}>
        <option value="">— اختر —</option>{(options[form.kind] || []).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
      <label>إثبات (اختياري): صورة تحويل أو إيصال<input type="file" accept="image/*,application/pdf" onChange={e => set({ file: e.target.files?.[0] || null })} /></label>
      <label className="fw-wide">ملاحظة (اختياري)<input value={form.note} onChange={e => set({ note: e.target.value })} placeholder="مثلًا: دفعتها كاش من جيبي" /></label>
    </div>
    {late && <div role="alert" className="fw-warning">التاريخ بعد بدء البنك ({day(cutoffDate)}): هذا النموذج لفترة التأسيس فقط.</div>}
    {recordDate && recordDate !== form.approxDate && <small>شهر {form.approxDate.slice(0, 7)} مقفل: يُسجّل بتاريخ {day(recordDate)} (آخر يوم في فترة التأسيس)، ويُحفظ تاريخه التقريبي.</small>}
    {fileError && <div role="alert" className="fw-warning">{fileError}</div>}
    <div className="fw-actions"><ConfirmButton primary label={uploading ? 'جارٍ رفع الإثبات...' : 'تسجيل المصروف بإقراري'} disabled={founding.busy || uploading || !ready}
      confirmText={`يسجّل ${money(Number(form.amount) || 0)} «${form.description.trim()}» بإقرارك، بتاريخ ${day(recordDate)}، بلا ضريبة مدخلات. لا ترحيل.`} onConfirm={save} /></div>
    <h3>القائمة ({list.length}) · {money(total)}</h3>
    {list.length === 0 ? <p>لا مصاريف بإقرار المدير بعد.</p> : <div className="fw-table-scroll"><table>
      <thead><tr><th>التاريخ التقريبي</th><th>سُجّل بتاريخ</th><th>الوصف</th><th>التصنيف</th><th>المبلغ</th><th>الإثبات</th><th>أقرّه</th><th>الحالة</th></tr></thead>
      <tbody>{list.map(e => <tr key={e.key}><td>{day(e.approxDate)}</td><td>{day(e.date)}</td><td>{e.title}</td><td>{KIND[e.kind]}{e.category ? ` — ${e.category}` : ''}</td>
        <td>{money(e.amount)}</td><td>{e.proofUrl ? <a className="underline" href={e.proofUrl} target="_blank" rel="noreferrer">عرض</a> : '—'}</td>
        <td>{e.byName} · <bdi>{when(e.atIso)}</bdi></td><td>{status(e)}</td></tr>)}</tbody>
    </table></div>}
  </section>;
}
