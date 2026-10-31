import { useState } from 'react';
import { formatNumber, todayISO } from '../data/initialData';
import { REVIEW_REASON_AR, labelOf } from '../lib/sweater/labels';
import { PrimaryButton, SecondaryButton } from './UI';

const SKIP_AR = { financially_locked: 'مرحّل أو في تسوية — لا يُمس', two_owner_records: 'نسختان عليهما قرار مالك — القرار لك' };
const field = 'block w-full rounded-control border p-2 bg-transparent';

/**
 * «توحيد الحجوزات برقمها» و«تعبئة نوع الخدمة»: معاينة لا تكتب شيئًا، ثم تطبيق بسبب مكتوب باسم المدير.
 * كل حجز يتغيّر يُحفظ قبله وبعده في سجل التدقيق مع المصدر. لا غسلة ولا قيد ولا ربط يتغيّر.
 */
export default function SweaterBookingCleanup({ onPreview, onApply, onFillPreview, onFillApply }) {
  const [preview, setPreview] = useState(null), [reason, setReason] = useState(''), [asking, setAsking] = useState(false);
  const [month, setMonth] = useState(todayISO().slice(0, 7)), [fill, setFill] = useState(null), [fillReason, setFillReason] = useState('');
  const [fillAsking, setFillAsking] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const run = async (fn) => { setBusy(true); setError(''); setNotice(''); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const s = preview?.summary;

  return <div role="region" aria-label="توحيد الحجوزات ونوع الخدمة" className="space-y-5">
    <section aria-label="توحيد الحجوزات برقمها" className="space-y-3">
      <h3 className="font-bold">توحيد الحجوزات برقمها</h3>
      <p className="text-sm">سويتر يعرض الحجز نفسه ببادئة تتغيّر مع حالته (B- قيد التنفيذ، S- منجز، C- ملغى). يُجمع كل رقم في حجز واحد بآخر قراءة من سويتر،
        ويبقى ما قرّرته أنت كما هو. تُغلق فروق المزامنة القديمة، ويبقى «تحتاج مراجعة» لما يحتاج قرارك فعلًا.</p>
      {preview?.lastApplied && <p className="text-xs text-slate-500" role="note">آخر توحيد: {preview.lastApplied.appliedAtIso?.slice(0, 16).replace('T', ' ')} ·
        بواسطة {preview.lastApplied.appliedByName || preview.lastApplied.appliedBy} · السبب: {preview.lastApplied.reason}</p>}
      <SecondaryButton disabled={busy} onClick={() => run(async () => { setAsking(false); setPreview(await onPreview()); })}>معاينة التوحيد</SecondaryButton>
      {s && (s.numbers === 0
        ? <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">كل الحجوزات موحّدة برقمها؛ لا شيء يتغيّر.</p>
        : <div className="space-y-3">
          <ul aria-label="ما سيتغيّر" className="text-sm grid sm:grid-cols-2 gap-x-6 gap-y-1">
            <li>أرقام تتغيّر: <b className="tabular-nums">{formatNumber(s.numbers)}</b></li>
            <li>نسخ مكررة تُدمج: <b className="tabular-nums">{formatNumber(s.duplicatesRemoved)}</b> (في {formatNumber(s.folded)} حجزًا)</li>
            <li>تحتاج قرارك بعد التوحيد: <b className="tabular-nums">{formatNumber(s.decisions)}</b></li>
            <li>بانتظار قراءة سويتر التالية: <b className="tabular-nums">{formatNumber(s.pending)}</b></li>
            <li>منتهية بلا قرار مطلوب: <b className="tabular-nums">{formatNumber(s.validated)}</b></li>
            <li>فروق قديمة تُغلق: <b className="tabular-nums">{formatNumber(s.variancesSuperseded)}</b> · تُفتح: <b className="tabular-nums">{formatNumber(s.variancesOpened)}</b></li>
          </ul>
          {Object.keys(s.decisionsByReason ?? {}).length > 0 && <ul aria-label="أسباب القرارات الباقية" className="text-sm list-disc ps-5">
            {Object.entries(s.decisionsByReason).map(([code, n]) => <li key={code}>{labelOf(REVIEW_REASON_AR, code)}: {formatNumber(n)}</li>)}</ul>}
          {s.skipped.length > 0 && <ul aria-label="ما لن يُمس" className="text-sm text-amber-700 dark:text-amber-300 list-disc ps-5">
            {s.skipped.map(k => <li key={k.number}><bdi>{k.number}</bdi>: {SKIP_AR[k.why] || k.why}</li>)}</ul>}
          {preview.rows.length > 0 && <details className="text-sm"><summary className="cursor-pointer font-semibold">التفاصيل ({formatNumber(preview.rows.length)})</summary>
            <table className="w-full mt-2 text-xs" aria-label="تفاصيل التوحيد"><thead><tr><th className="text-start p-1">الرقم</th><th className="text-start p-1">النسخ</th>
              <th className="text-start p-1">آخر قراءة</th><th className="text-start p-1">بعد التوحيد</th></tr></thead>
            <tbody>{preview.rows.map(r => <tr key={r.number} className="border-t border-slate-100 dark:border-slate-800">
              <td className="p-1 tabular-nums">{r.number}</td><td className="p-1" dir="ltr">{r.copies.join(' · ')}</td>
              <td className="p-1">{r.latest ? <><bdi>{r.latest.sspBookingId}</bdi> · {r.latest.rawStatus}</> : '—'}</td>
              <td className="p-1">{r.processingStatus === 'needs_review' ? labelOf(REVIEW_REASON_AR, r.reasonCode) : r.processingStatus === 'pending_source'
                ? 'بانتظار سويتر' : 'منتهٍ'}{r.held ? ' · سجل المالك باقٍ' : ''}</td></tr>)}</tbody></table></details>}
          <label className="text-sm block">سبب التوحيد<input className={field} value={reason} onChange={e => { setReason(e.target.value); setAsking(false); }}
            placeholder="مثلًا: توحيد نسخ B/S/C بعد مراجعة المعاينة" /></label>
          {!asking ? <PrimaryButton disabled={busy || !reason.trim()} onClick={() => setAsking(true)}>تطبيق التوحيد</PrimaryButton>
            : <div role="group" aria-label="تأكيد التوحيد" className="flex flex-wrap gap-2 items-center text-sm">
              <span>يغيّر {formatNumber(s.numbers)} حجزًا باسمك ويحفظ كل نسخة قبله في سجل التدقيق. لا غسلة ولا قيد يتغيّر.</span>
              <PrimaryButton disabled={busy} onClick={() => run(async () => {
                const r = await onApply({ reason: reason.trim(), previewHash: preview.previewHash });
                setAsking(false); setReason(''); setPreview(await onPreview());
                setNotice(`وُحّد ${formatNumber(r.applied)} حجزًا باسمك.`);
              })}>تأكيد</PrimaryButton><SecondaryButton disabled={busy} onClick={() => setAsking(false)}>إلغاء</SecondaryButton></div>}
        </div>)}
    </section>

    <section aria-label="تعبئة نوع الخدمة" className="space-y-3 border-t pt-4 border-slate-200 dark:border-slate-700">
      <h3 className="font-bold">تعبئة نوع الخدمة للحجوزات المكتملة</h3>
      <p className="text-sm">تقرير «Biker Bookings and Tips» في لوحة سويتر يبيّن نوع الخدمة لكل حجز مكتمل. الحجوزات المكتملة بلا نوع في الشهر تُعبّأ «غسيل كامل (Full Wash)»،
        والتقرير مصدرها في سجل التدقيق. بعد توحيد الحجوزات فقط.</p>
      <div className="flex flex-wrap gap-2 items-end">
        <label className="text-sm">الشهر<input type="month" className={field} value={month} onChange={e => { setMonth(e.target.value); setFill(null); setFillAsking(false); }} /></label>
        <SecondaryButton disabled={busy || !month} onClick={() => run(async () => { setFillAsking(false); setFill(await onFillPreview({ periodKey: month })); })}>معاينة التعبئة</SecondaryButton>
      </div>
      {fill && (fill.rows.length === 0
        ? <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">لا حجز مكتمل بلا نوع في {fill.periodKey}.</p>
        : <div className="space-y-3">
          <p className="text-sm" role="status">{formatNumber(fill.rows.length)} حجزًا مكتملًا بلا نوع خدمة · منها {formatNumber(fill.rows.filter(r => r.hasWash).length)} لها غسلة مسجلة ·
            يبقى بعدها {formatNumber(fill.rows.filter(r => r.processingStatus === 'needs_review').length)} يحتاج قرارك.</p>
          <label className="text-sm block">سبب التعبئة<input className={field} value={fillReason} onChange={e => { setFillReason(e.target.value); setFillAsking(false); }}
            placeholder="مثلًا: كل المكتمل في الشهر Full Wash حسب تقرير سويتر" /></label>
          {!fillAsking ? <PrimaryButton disabled={busy || !fillReason.trim()} onClick={() => setFillAsking(true)}>تعبئة نوع الخدمة</PrimaryButton>
            : <div role="group" aria-label="تأكيد التعبئة" className="flex flex-wrap gap-2 items-center text-sm">
              <span>يكتب «غسيل كامل» في {formatNumber(fill.rows.length)} حجزًا باسمك، والمصدر تقرير سويتر.</span>
              <PrimaryButton disabled={busy} onClick={() => run(async () => {
                const r = await onFillApply({ periodKey: fill.periodKey, reason: fillReason.trim(), previewHash: fill.previewHash });
                setFillAsking(false); setFillReason(''); setFill(await onFillPreview({ periodKey: fill.periodKey }));
                setNotice(`عُبّئ نوع الخدمة في ${formatNumber(r.filled)} حجزًا باسمك.`);
              })}>تأكيد</PrimaryButton><SecondaryButton disabled={busy} onClick={() => setFillAsking(false)}>إلغاء</SecondaryButton></div>}
        </div>)}
    </section>
    {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
    {notice && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}
  </div>;
}
