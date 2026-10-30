import { useState } from 'react';
import { CopyX, Wallet } from 'lucide-react';
import { ConfirmButton, EntryLines, StatusBadge } from './FoundingCommon';
import { money, day, when } from '../../lib/founding/foundingFormat';

const NO_WRAP = { whiteSpace: 'nowrap' };
const docLabel = d => `${d.title} — ${money(d.amount)} — ${day(d.date)}`;
const textMatch = (d, term) => !term || `${d.title} ${d.supplier || ''} ${d.amount}`.includes(term);

/**
 * «إلغاء مستند مكرر»: مستند مرحّل يكرر مستندًا أصليًا ← قيد مقترح يعكس كل أثره الساري، بسبب يكتبه هادي.
 * لا يُرحّل إلا بموافقته من «قيود التصحيح والتسوية»، ولا يُعدَّل أي قيد أصلي.
 */
export function DuplicateCancellations({ founding, names }) {
  const { plan } = founding.data, list = plan.entries.filter(e => e.type === 'duplicate'), cancelled = plan.cancelled || [];
  const blank = { key: '', originalKey: '', reason: '', search: '' };
  const [form, setForm] = useState(blank);
  const set = patch => setForm(f => ({ ...f, ...patch }));
  const term = form.search.trim();
  const doc = plan.rows.find(d => d.key === form.key), original = plan.rows.find(d => d.key === form.originalKey);
  const postedRows = plan.rows.filter(d => d.protected && !d.duplicate);
  const choices = postedRows.filter(d => d.key === form.key || textMatch(d, term)).slice(0, 80);
  const others = plan.rows.filter(d => d.key !== form.key && !d.duplicate);
  const sameAmount = doc ? others.filter(d => Math.round(d.amount * 100) === Math.round(doc.amount * 100)) : [];
  const ready = doc && original && form.reason.trim().length >= 5;
  return <section className="fw-panel" aria-label="إلغاء مستند مكرر">
    <h2><CopyX size={18} /> إلغاء مستند مكرر</h2>
    <p>اختر مستندًا مرحّلًا وحدد المستند الأصلي اللي يكرره. يُحفظ قيدًا مقترحًا باسمك يعكس كل أثره الساري: قيده، و«تصحيح جهة دفع»، وحصته من تصحيحات الصندوق والبنك.
      لا يُرحّل إلا بموافقتك من «قيود التصحيح والتسوية»، ولا يُعدَّل أي قيد أصلي. بعد ترحيله يصير المستند «ملغى — مكرر» ويطلع من «ملخص فترة التأسيس» ومن حساب 2300.</p>
    <div className="fw-form">
      <label>بحث في المستندات المرحّلة<input value={form.search} onChange={e => set({ search: e.target.value })} placeholder="الوصف أو المورد أو المبلغ" /></label>
      <label className="fw-wide">المستند المكرر (مرحّل)<select value={form.key} onChange={e => set({ key: e.target.value, originalKey: '' })}>
        <option value="">اختر المستند</option>{choices.map(d => <option key={d.key} value={d.key}>{docLabel(d)}</option>)}</select></label>
      <label className="fw-wide">المستند الأصلي اللي يكرره<select value={form.originalKey} disabled={!doc} onChange={e => set({ originalKey: e.target.value })}>
        <option value="">اختر الأصلي</option>
        {sameAmount.length > 0 && <optgroup label="بنفس المبلغ">{sameAmount.map(d => <option key={d.key} value={d.key}>{docLabel(d)}</option>)}</optgroup>}
        <optgroup label="باقي المستندات">{others.filter(d => !sameAmount.includes(d)).map(d => <option key={d.key} value={d.key}>{docLabel(d)}</option>)}</optgroup>
      </select></label>
      <label className="fw-wide">السبب<input value={form.reason} onChange={e => set({ reason: e.target.value })} placeholder="مثلًا: نفس الفاتورة سُجّلت مرتين" /></label>
    </div>
    {doc && original && Math.round(doc.amount * 100) !== Math.round(original.amount * 100)
      && <p className="fw-warning" role="note">المبلغان مختلفان: المكرر {money(doc.amount)} والأصلي {money(original.amount)}. تأكد أنهما نفس المصروف.</p>}
    <div className="fw-actions"><ConfirmButton primary label="حفظ الإلغاء قيدًا مقترحًا" disabled={founding.busy || !ready}
      confirmText={`يحفظ اقتراحًا بإلغاء «${doc?.title || ''}» مكررًا لـ«${original?.title || ''}» بسببك، باسمك ووقتك. لا ترحيل ولا تعديل لأي قيد.`}
      onConfirm={async () => { if (await founding.act({ action: 'proposeDuplicate', key: form.key, originalKey: form.originalKey, reason: form.reason.trim(), confirm: true },
        'حُفظ الإلغاء مقترحًا؛ قيده في «قيود التصحيح والتسوية».')) setForm(blank); }} /></div>
    {list.length > 0 && <ul className="founding-list">{list.map(e => <li key={e.key}>
      <strong>{e.title}</strong> · مكرر لـ«{e.originalTitle}» · {money(e.amount)} <StatusBadge status={e.status} />{e.entryNumber ? <span> قيد رقم {e.entryNumber}</span> : null}
      {e.sources?.length > 0 && <small> — يعكس: {e.sources.map(x => `${x.label} #${x.entryNumber ?? '—'}`).join('، ')}</small>}
      <EntryLines lines={e.lines} names={names} />
      <small>السبب: {e.reason} · {e.proposedByName}، <bdi>{when(e.proposedAtIso)}</bdi>{e.postedReason ? ` · سبب الموافقة: ${e.postedReason}` : ''}</small>
      {e.status !== 'posted' && <ConfirmButton label="حذف" disabled={founding.busy} confirmText="يحذف الاقتراح. لا قيد."
        onConfirm={() => founding.act({ action: 'removeDuplicate', id: e.id, confirm: true }, 'حُذف الاقتراح.')} />}
    </li>)}</ul>}
    {cancelled.length > 0 && <details className="fw-form-section"><summary>ملغاة — مكررة ({cancelled.length})</summary><ul className="founding-list">
      {cancelled.map(d => <li key={d.key}>ملغى — مكرر لـ«{d.originalTitle || d.originalKey}»: {docLabel(d)}{d.entryNumber ? ` · قيد الإلغاء ${d.entryNumber}` : ''}</li>)}
    </ul></details>}
  </section>;
}

/**
 * «تسوية مصروف مؤقت»: بند مؤقت مرحّل على 1300 ← قيد مقترح: مدين حساب المصروف، دائن 1300. قبل القطع بآخر يوم
 * في فترة التأسيس. لا يُرحّل إلا بموافقة هادي؛ بعد ترحيله يُعلَّم البند مسوّى فلا يُخصم من راتب ولا يُسترد نقدًا.
 */
export function CustodySettlements({ founding, names }) {
  const { plan, expenseAccounts = [] } = founding.data, list = plan.entries.filter(e => e.type === 'custody_settlement'), items = plan.custodyItems || [];
  const blank = { advanceId: '', accountId: expenseAccounts.some(a => a.code === '5300') ? '5300' : expenseAccounts[0]?.code || '', reason: '' };
  const [form, setForm] = useState(blank);
  const set = patch => setForm(f => ({ ...f, ...patch }));
  const item = items.find(a => a.id === form.advanceId);
  const ready = item && form.accountId && form.reason.trim().length >= 5;
  return <section className="fw-panel" aria-label="تسوية مصروف مؤقت">
    <h2><Wallet size={18} /> تسوية مصروف مؤقت</h2>
    <p>اختر بندًا مؤقتًا مرحّلًا على 1300 وحدد حساب المصروف. يُحفظ قيدًا مقترحًا باسمك: مدين المصروف، دائن 1300 بالباقي على البند،
      وبتاريخ <bdi style={NO_WRAP}>{day(plan.settings.foundingEnd)}</bdi> لو البند قبل <bdi style={NO_WRAP}>{day(plan.settings.cutoffDate)}</bdi>. لا يُرحّل إلا بموافقتك من «قيود التصحيح والتسوية»، ولا يُعدَّل قيد البند.
      بعد ترحيله يُعلَّم البند مسوّى بالقيد، فلا يُخصم من راتب ولا يُسترد نقدًا.</p>
    <div className="fw-form">
      <label className="fw-wide">البند المؤقت (مرحّل على 1300)<select value={form.advanceId} onChange={e => set({ advanceId: e.target.value })}>
        <option value="">اختر البند</option>{items.map(a => <option key={a.id} value={a.id}>
          {`${a.title}${a.holder ? ` — ${a.holder}` : ''} — باقي ${money(a.outstanding)} — ${day(a.spentDate)}${a.entryNumber ? ` — قيد #${a.entryNumber}` : ''}`}</option>)}</select></label>
      <label>حساب المصروف<select value={form.accountId} onChange={e => set({ accountId: e.target.value })}>
        {expenseAccounts.map(a => <option key={a.code} value={a.code}>{`${a.code} ${a.name}`}</option>)}</select></label>
      <label className="fw-wide">السبب<input value={form.reason} onChange={e => set({ reason: e.target.value })} placeholder="مثلًا: صُرفت على المشروع ولا تُسترد من الموظف" /></label>
    </div>
    {item && form.accountId && <>
      <small>تاريخ القيد: <bdi style={NO_WRAP}>{day(item.postingDate)}</bdi>{item.postingDate !== item.spentDate ? ` (البند ${day(item.spentDate)} قبل القطع)` : ''}</small>
      <EntryLines names={names} lines={[{ accountId: form.accountId, debit: item.outstanding, credit: 0, description: `تسوية مصروف مؤقت — ${item.title}` },
        { accountId: '1300', debit: 0, credit: item.outstanding, description: item.holder ? `${item.title} — عهدة ${item.holder}` : item.title }]} />
    </>}
    <div className="fw-actions"><ConfirmButton primary label="حفظ التسوية قيدًا مقترحًا" disabled={founding.busy || !ready}
      confirmText={`يحفظ قيدًا مقترحًا بـ ${money(item?.outstanding || 0)} على ${form.accountId} بسببك، باسمك ووقتك. لا ترحيل.`}
      onConfirm={async () => { if (await founding.act({ action: 'proposeCustodySettlement', advanceId: form.advanceId, accountId: form.accountId, reason: form.reason.trim(), confirm: true },
        'حُفظت التسوية مقترحة؛ قيدها في «قيود التصحيح والتسوية».')) setForm(blank); }} /></div>
    {list.length > 0 && <ul className="founding-list">{list.map(e => <li key={e.key}>
      <strong>{e.title}</strong>{e.holder ? ` · ${e.holder}` : ''} · {money(e.amount)} · {day(e.date)} <StatusBadge status={e.status} />{e.entryNumber ? <span> قيد رقم {e.entryNumber}</span> : null}
      <EntryLines lines={e.lines} names={names} />
      <small>السبب: {e.reason} · {e.proposedByName}، <bdi>{when(e.proposedAtIso)}</bdi>{e.postedReason ? ` · سبب الموافقة: ${e.postedReason}` : ''}</small>
      {e.status !== 'posted' && <ConfirmButton label="حذف" disabled={founding.busy} confirmText="يحذف التسوية المقترحة. لا قيد."
        onConfirm={() => founding.act({ action: 'removeCustodySettlement', id: e.id, confirm: true }, 'حُذفت التسوية.')} />}
    </li>)}</ul>}
  </section>;
}
