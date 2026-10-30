import { useState } from 'react';
import { HandCoins } from 'lucide-react';
import { useFounding } from '../../hooks/useFounding';
import { ConfirmButton, EntryLines, Messages, StatusBadge } from './FoundingCommon';
import { money, day, when } from '../../lib/founding/foundingFormat';
import '../FinanceWorkspace.css';
import './Founding.css';

/**
 * سندات قبض الشركاء التي وصلت لحساب هادي ولا قيد لها: مدين 2300 ودائن رأس
 * مال الشريك بتاريخ السند. تُحفظ قيودًا مقترحة بسبب مكتوب، وتُرحّل بالموافقة.
 * للإدارة وحدها (قراءة الخادم وكتاباته للإدارة فقط).
 */
export function ReceiptPostings({ onPosted }) {
  const founding = useFounding();
  const [picked, setPicked] = useState(() => new Set()), [reason, setReason] = useState('');
  const [approve, setApprove] = useState(() => new Set()), [approval, setApproval] = useState('');
  if (!founding.allowed) return null;
  const plan = founding.data?.plan;
  const candidates = plan?.receipts || [], proposed = plan ? plan.entries.filter(e => e.type === 'receipt') : [];
  const open = candidates.filter(c => !c.blocked), chosen = open.filter(c => picked.has(c.key));
  const ready = proposed.filter(e => e.status === 'proposed'), toPost = ready.filter(e => approve.has(e.key));
  const toggle = (set, key) => set(cur => { const next = new Set(cur); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const total = list => list.reduce((n, x) => n + Number(x.amount), 0);
  return <section className="fw-panel founding-page" dir="rtl" aria-label="سندات قبض وصلت لحساب هادي بلا قيد">
    <h2><HandCoins size={18} /> سندات قبض وصلت لحساب هادي بلا قيد</h2>
    <p>لكل سند: مدين 2300 حساب هادي الجاري، ودائن رأس مال الشريك، بتاريخ السند. السند في شهر مقفل من فترة التأسيس يُقيَّد بآخر يوم فيها، والشهر يبقى مقفلًا.
      يُحفظ قيدًا مقترحًا بسببك، ولا يُرحّل إلا بموافقتك. «وصلت لحساب هادي» من قرارك في تسوية فترة التأسيس أو مما سُجّل في السند.</p>
    <Messages error={founding.error} actionError={founding.actionError} notice={founding.notice} />
    {founding.loading && <p>جارٍ القراءة...</p>}
    {plan && <>
      <h3>بلا قيد ({candidates.length}) · {money(total(candidates))}</h3>
      {candidates.length === 0 ? <p>لا سندات وصلت لحساب هادي بلا قيد.</p> : <div className="fw-table-scroll"><table>
        <thead><tr><th></th><th>الشريك</th><th>تاريخ السند</th><th>المبلغ</th><th>وصلت لهادي</th><th>تاريخ القيد</th></tr></thead>
        <tbody>{candidates.map(c => <tr key={c.key}>
          <td>{c.blocked ? <StatusBadge status="blocked_period" /> : <input type="checkbox" aria-label={`اختيار سند ${c.partnerName} ${c.date}`} checked={picked.has(c.key)} onChange={() => toggle(setPicked, c.key)} />}</td>
          <td>{c.partnerName}</td><td>{day(c.date)}</td><td>{money(c.amount)}</td><td>{c.arrivalSource === 'recorded' ? 'مسجّل في السند' : 'بقرارك'}</td>
          <td>{day(c.postingDate)}{c.postingDate !== c.date ? ' (شهر السند مقفل)' : ''}</td>
        </tr>)}</tbody>
      </table></div>}
      {open.length > 0 && <>
        <div className="fw-form"><label className="fw-wide">السبب<input value={reason} onChange={e => setReason(e.target.value)} placeholder="مثلًا: الدفعات وصلت لحسابي الشخصي قبل بدء حساب الشركة" /></label></div>
        <div className="fw-actions">
          <button type="button" onClick={() => setPicked(new Set(open.map(c => c.key)))}>اختيار الكل ({open.length})</button>
          <ConfirmButton primary label={`حفظ قيود مقترحة (${chosen.length})`} disabled={founding.busy || !chosen.length || reason.trim().length < 5}
            confirmText={`يحفظ ${chosen.length} قيدًا مقترحًا مجموعها ${money(total(chosen))} بسببك، باسمك ووقتك. لا ترحيل.`}
            onConfirm={async () => { if (await founding.act({ action: 'proposeReceipts', keys: chosen.map(c => c.key), reason: reason.trim(), confirm: true }, 'حُفظت القيود مقترحة.')) { setPicked(new Set()); setReason(''); } }} />
        </div>
      </>}
      <h3>قيود مقترحة ({proposed.length})</h3>
      {proposed.length === 0 ? <p>لا قيود مقترحة.</p> : proposed.map(e => <article key={e.key} className="founding-entry">
        <header>
          {e.status === 'proposed' && <input type="checkbox" aria-label={`اختيار القيد: ${e.title} ${e.originalDate}`} checked={approve.has(e.key)} onChange={() => toggle(setApprove, e.key)} />}
          <strong>{e.title}</strong> <span>{day(e.originalDate)}{e.date !== e.originalDate ? ` ← يُقيَّد ${day(e.date)}` : ''}</span> <StatusBadge status={e.status} />
          {e.entryNumber ? <span>قيد رقم {e.entryNumber}</span> : null}
        </header>
        <small>السبب: {e.reason} — {e.proposedByName}، <bdi>{when(e.proposedAtIso)}</bdi>{e.postedReason ? ` · سبب الموافقة: ${e.postedReason}` : ''}</small>
        <EntryLines lines={e.lines} names={founding.data.accountNames} />
        {e.status !== 'posted' && <ConfirmButton label="حذف" disabled={founding.busy} confirmText="يحذف القيد المقترح. لا ترحيل."
          onConfirm={() => founding.act({ action: 'removeReceipt', key: e.sourceKey, confirm: true }, 'حُذف القيد المقترح.')} />}
      </article>)}
      {ready.length > 0 && <>
        <div className="fw-form"><label className="fw-wide">سبب الموافقة<input value={approval} onChange={e => setApproval(e.target.value)} placeholder="مثلًا: راجعت السندات ووصولها لحسابي" /></label></div>
        <div className="fw-actions">
          <button type="button" onClick={() => setApprove(new Set(ready.map(e => e.key)))}>اختيار كل الجاهز ({ready.length})</button>
          <ConfirmButton primary label={`موافقة وترحيل المحدد (${toPost.length})`} disabled={founding.busy || !toPost.length || approval.trim().length < 3}
            confirmText={`يرحّل ${toPost.length} قيدًا بأسطرها المعروضة (${money(total(toPost))}). لا يغيّر أي قيد مرحّل.`}
            onConfirm={async () => {
              const done = await founding.act({ action: 'postEntries', reason: approval.trim(), confirm: true, entries: toPost.map(e => ({ key: e.key, hash: e.hash })) }, 'رُحّلت القيود المحددة.');
              if (done) { setApprove(new Set()); setApproval(''); onPosted?.(); }
            }} />
        </div>
      </>}
    </>}
  </section>;
}
