import { useState } from 'react';
import { formatNumber } from '../data/initialData';
import { PrimaryButton, SecondaryButton } from './UI';

const field = 'block w-full rounded-control border p-2 bg-transparent';
const at = iso => <bdi dir="ltr">{iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh' }) : '—'}</bdi>;
const range = (from, to) => <bdi dir="ltr">{from === to ? from : `${from} → ${to}`}</bdi>;
const BASIS_AR = { source_observed_before_execution: 'ظهر البايكر الجديد في الطريق قبل البدء',
  source_start_and_end_same_biker: 'البداية والنهاية للبايكر نفسه' };

/**
 * «الحجوزات المفتوحة في سويتر»: كل مزامنة تقرأ آخر 3 أيام وتعيد قراءة كل حجز غير نهائي برقمه.
 * يعرض نافذة آخر مزامنة، وما لم تُعِد قراءته منذ متى، و«قراءات سويتر المحفوظة»: قراءة أحدث وصلت
 * من سويتر ولم تُطبَّق على حجزها؛ تُطبَّق بمعاينة ثم سبب وتأكيد للمدير، بمسار المزامنة نفسه.
 */
export default function SweaterOpenBookings({ status, loading, error, canApply = false, onPreview, onApply }) {
  const [preview, setPreview] = useState(null), [reason, setReason] = useState(''), [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState(''), [notice, setNotice] = useState('');
  const run = async fn => { setBusy(true); setFailure(''); setNotice(''); try { await fn(); } catch (e) { setFailure(e.message); } finally { setBusy(false); } };
  if (loading && !status) return <p role="status" className="text-sm">جارٍ قراءة الحجوزات المفتوحة…</p>;
  if (error && !status) return <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">تعذرت قراءة الحجوزات المفتوحة: {error.message}</p>;
  if (!status) return null;
  const last = status.lastSync, req = status.required, short = last && last.days < req.days;

  return <div role="region" aria-label="الحجوزات المفتوحة في سويتر" className="space-y-4">
    <section className="space-y-2">
      <p className="text-sm">المطلوب في كل مزامنة: أيام {range(req.rangeFrom, req.rangeTo)} ({formatNumber(req.days)} أيام)، وكل حجز ما زال مفتوحًا في سويتر برقمه
        حتى يصير Collecting Payment أو Cancelled by Admin.</p>
      {last ? <p className="text-sm" aria-label="آخر مزامنة">آخر مزامنة: قرأت {range(last.rangeFrom, last.rangeTo)} ({formatNumber(last.days)} {last.days === 1 ? 'يوم' : 'أيام'}) · {at(last.extractedAtIso)}</p>
        : <p className="text-sm">لم تصل مزامنة بعد.</p>}
      {short && <p role="alert" className="text-sm text-amber-800 dark:text-amber-300">آخر مزامنة قرأت أقل من {formatNumber(req.days)} أيام: الحجز الذي يكتمل بعد يومه لا يُقرأ ثانية،
        فلا تُسجَّل غسلته. على الوكيل 7 أن يقرأ النافذة كاملة ويعيد قراءة الحجوزات المفتوحة.</p>}
      <p className="text-sm">مفتوحة الآن: <b className="tabular-nums">{formatNumber(status.open.length)}</b> · لم تُعِد آخر مزامنة قراءتها:{' '}
        <b className={`tabular-nums ${status.notReread.length ? 'text-amber-700 dark:text-amber-300' : ''}`}>{formatNumber(status.notReread.length)}</b></p>
      {status.notReread.length > 0 && <details className="text-sm"><summary className="cursor-pointer font-semibold">ما لم يُعَد قراءته ({formatNumber(status.notReread.length)})</summary>
        <table className="w-full mt-2 text-xs" aria-label="حجوزات مفتوحة لم يُعَد قراءتها"><thead><tr><th className="text-start p-1">الحجز</th><th className="text-start p-1">اليوم</th>
          <th className="text-start p-1">آخر حالة</th><th className="text-start p-1">آخر قراءة</th></tr></thead>
        <tbody>{status.notReread.map(b => <tr key={b.bookingNumber} className="border-t border-slate-100 dark:border-slate-800">
          <td className="p-1 tabular-nums">{b.bookingNumber}</td><td className="p-1 tabular-nums">{b.serviceDate}</td><td className="p-1"><bdi>{b.rawStatus}</bdi></td>
          <td className="p-1">{at(b.observedAtIso)}{b.hoursSinceRead != null ? <> · منذ <bdi dir="ltr">{b.hoursSinceRead}</bdi> ساعة</> : null}</td></tr>)}</tbody></table></details>}
    </section>

    {canApply && <section className="space-y-3 border-t pt-4 border-slate-200 dark:border-slate-700" aria-label="قراءات سويتر المحفوظة">
      <h3 className="font-bold">قراءات سويتر المحفوظة ولم تُطبَّق</h3>
      <p className="text-sm">قراءة أحدث وصلت من سويتر وحُفظت، ولم تُطبَّق على حجزها (مثل حجز أنهاه سويتر بعد قراءته الأولى). تُطبَّق بالمسار نفسه الذي تمر به كل مزامنة،
        فتُسجَّل الغسلة إن ثبتت بالبداية والنهاية. لا قراءة جديدة من سويتر ولا قيد.</p>
      <SecondaryButton disabled={busy} onClick={() => run(async () => { setAsking(false); setPreview(await onPreview()); })}>معاينة القراءات المحفوظة</SecondaryButton>
      {preview?.lastApplied && <p className="text-xs text-slate-500" role="note">آخر تطبيق: {at(preview.lastApplied.appliedAtIso)} · بواسطة {preview.lastApplied.appliedByName || preview.lastApplied.appliedBy}
        · السبب: {preview.lastApplied.reason}</p>}
      {preview && (preview.rows.length === 0
        ? <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">لا قراءة محفوظة تنتظر التطبيق.</p>
        : <div className="space-y-3">
          <table className="w-full text-xs" aria-label="القراءات المحفوظة"><thead><tr><th className="text-start p-1">الحجز</th><th className="text-start p-1">اليوم</th>
            <th className="text-start p-1">الحالة عندنا</th><th className="text-start p-1">قراءة سويتر المحفوظة</th><th className="text-start p-1">بعد التطبيق</th></tr></thead>
          <tbody>{preview.rows.map(r => <tr key={r.number} className="border-t border-slate-100 dark:border-slate-800">
            <td className="p-1 tabular-nums">{r.number}</td><td className="p-1 tabular-nums">{r.serviceDate}</td><td className="p-1"><bdi>{r.current.rawStatus}</bdi></td>
            <td className="p-1"><bdi>{r.stored.rawStatus}</bdi> · {at(r.stored.extractedAtIso)}</td>
            <td className="p-1">{r.recordsWash ? 'تُسجَّل الغسلة' : r.outcome === 'needs_review' ? 'يحتاج قرارك' : 'تُحدَّث الحالة'}
              {r.reassignment ? ` · تغيّر البايكر قبل التنفيذ (${BASIS_AR[r.reassignment.executionWorkerBasis] ?? ''}): تُحسب لمن نفّذها` : ''}</td></tr>)}</tbody></table>
          <p className="text-sm" role="status">تُسجَّل {formatNumber(preview.rows.filter(r => r.recordsWash).length)} غسلة من {formatNumber(preview.rows.length)} حجزًا.</p>
          <label className="text-sm block">سبب التطبيق<input className={field} value={reason} onChange={e => { setReason(e.target.value); setAsking(false); }}
            placeholder="مثلًا: غسلات أنهاها سويتر ولم تُعَد قراءتها بعد التوحيد" /></label>
          {!asking ? <PrimaryButton disabled={busy || !reason.trim()} onClick={() => setAsking(true)}>طبّق القراءات المحفوظة</PrimaryButton>
            : <div role="group" aria-label="تأكيد تطبيق القراءات" className="flex flex-wrap gap-2 items-center text-sm">
              <span>يطبّق {formatNumber(preview.rows.length)} قراءة باسمك، وسطر تدقيق لكل حجز. لا قيد ولا تحصيل.</span>
              <PrimaryButton disabled={busy} onClick={() => run(async () => {
                const r = await onApply({ reason: reason.trim(), previewHash: preview.previewHash });
                setAsking(false); setReason(''); setPreview(await onPreview());
                setNotice(`طُبّقت ${formatNumber(r.applied)} قراءة باسمك وسُجّلت ${formatNumber(r.washesCreated)} غسلة.`);
              })}>تأكيد</PrimaryButton><SecondaryButton disabled={busy} onClick={() => setAsking(false)}>إلغاء</SecondaryButton></div>}
        </div>)}
    </section>}
    {failure && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{failure}</p>}
    {notice && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}
  </div>;
}
