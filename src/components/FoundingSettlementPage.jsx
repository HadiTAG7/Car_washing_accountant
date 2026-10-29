import { useState } from 'react';
import { RefreshCw, Scale } from 'lucide-react';
import TopBar from './TopBar';
import LoadingState from './LoadingState';
import { useFounding } from '../hooks/useFounding';
import { ConfirmButton, EntryLines, Messages, StatusBadge } from './founding/FoundingCommon';
import { money, day } from '../lib/founding/foundingFormat';
import { DefaultRule, StatementComparison } from './founding/FoundingRule';
import './FinanceWorkspace.css';
import './founding/Founding.css';

const DOC_DECISIONS = { hadi: 'من حسابي', partner: 'من جيب شريك', custody: 'من عهدة', cash: 'كاش', unknown: 'غير معروف' };
const ARRIVALS = { hadi: 'حسابي', company: 'حساب الشركة' };
const PAYERS = { hadi: 'حساب هادي', company_bank: 'حساب الشركة', partner: 'جيب شريك', custody: 'عهدة', cash: 'كاش', unknown: 'غير معروف' };
const payerText = r => !r.payer ? 'لم يُحسم' : r.payerSource === 'rule' ? 'دفع شخصي - فترة التأسيس (القاعدة)'
  : r.payer === 'custody' ? `من عهدة ${r.custodian || ''}` : PAYERS[r.payer] || r.payer;
const KIND = { variable: 'متغيرة', monthly: 'شهرية', annual: 'سنوية', startup: 'تأسيس' };

export default function FoundingSettlementPage() {
  const founding = useFounding();
  const data = founding.data, plan = data?.plan;
  if (!founding.allowed) return <div className="fw-page"><p role="alert">تسوية فترة التأسيس للإدارة فقط.</p></div>;
  return <>
    <TopBar title="تسوية فترة التأسيس" subtitle="مطابقة ما قبل تاريخ القطع، والقيود المقترحة بانتظار موافقتك" />
    <main className="fw-page founding-page" dir="rtl">
      <div className="fw-toolbar">
        <p>لا يتغير مستند ولا يُرحّل قيد إلا بعد «تطبيق» أو «موافقة» منك. القرارات تُحفظ باسم من قررها ووقتها.</p>
        <button type="button" onClick={founding.refresh}><RefreshCw size={16} /> تحديث القراءة</button>
      </div>
      <Messages error={founding.error} actionError={founding.actionError} notice={founding.notice} />
      {founding.loading && <LoadingState message="جارٍ حساب تسوية فترة التأسيس..." />}
      {plan && <>
        {/* A saved revision remounts the form with the stored values. */}
        <Settings key={Number(data.review?.revision) || 0} founding={founding} />
        <DefaultRule founding={founding} partners={data.partners} names={data.accountNames} />
        <StatementComparison plan={plan} names={data.accountNames} />
        <div className="fw-metrics">
          {[['matched', 'أ) مطابقة لكشف'], ['small', 'ب) تحت الحد بلا إثبات'], ['large', 'ج) فوق الحد بلا إثبات'], ['partners', 'د) دفعات الشركاء'], ['withProof', 'بإثبات ولم تطابق كشفًا']]
            .map(([key, label]) => <div key={key} className="fw-panel fw-metric"><span>{label}</span><strong>{plan.totals[key].count}</strong><p>{money(plan.totals[key].amount)}</p></div>)}
        </div>
        <Matched rows={plan.groups.matched} />
        <Small rows={plan.groups.small} founding={founding} threshold={plan.settings.threshold} />
        <Large rows={plan.groups.large} founding={founding} partners={data.partners} />
        <Partners rows={plan.groups.partners} founding={founding} />
        <Updates rows={plan.updates} founding={founding} />
        <VatTouching rows={plan.vatTouching} founding={founding} quarters={data.filedQuarters} />
        <Entries plan={plan} founding={founding} names={data.accountNames} />
        <PostCutoff rows={plan.postCutoff} cutoff={plan.settings.cutoffDate} />
      </>}
    </main>
  </>;
}

function Settings({ founding }) {
  const { plan, review, custodyHint } = founding.data;
  const initial = () => ({ cutoffDate: plan.settings.cutoffDate, threshold: plan.settings.threshold,
    bankOpen: plan.settings.actuals?.bankOpen ?? true, bankBalance: plan.settings.actuals?.bankBalance ?? '', cash: plan.settings.actuals?.cash ?? '',
    custody: plan.settings.actuals?.custody || [] });
  const [form, setForm] = useState(initial);
  const revision = Number(review?.revision) || 0;
  const set = patch => setForm(f => ({ ...f, ...patch }));
  const number = value => (value === '' || value == null ? null : Number(value));
  const actualsReady = form.cash !== '' && (!form.bankOpen || form.bankBalance !== '');
  const s = plan.settlement;
  return <section className="fw-panel" aria-label="إعدادات القطع والواقع">
    <h2><Scale size={18} /> القطع والواقع يوم القطع</h2>
    <p>تاريخ القطع = اليوم الذي بدأ فيه حساب البنك يشتغل. فترة التأسيس كل ما قبله، وقيودها مؤرخة بآخر يوم فيها ({day(plan.settings.foundingEnd)}).</p>
    <div className="fw-form">
      <label>تاريخ القطع — يوم بدء عمل حساب البنك<input type="date" value={form.cutoffDate} onChange={e => set({ cutoffDate: e.target.value })} /></label>
      <label>حد المبالغ الصغيرة (ريال)<input type="number" min="0" value={form.threshold} onChange={e => set({ threshold: e.target.value })} /></label>
      <label className="founding-check"><input type="checkbox" checked={form.bankOpen} onChange={e => set({ bankOpen: e.target.checked })} /> حساب الشركة كان مفتوحًا يوم القطع</label>
      {form.bankOpen && <label>رصيد حساب الشركة يوم القطع<input type="number" value={form.bankBalance} onChange={e => set({ bankBalance: e.target.value })} /></label>}
      <label>الكاش في الصندوق يوم القطع<input type="number" value={form.cash} onChange={e => set({ cash: e.target.value })} /></label>
    </div>
    <h3>العهد عند كل شخص يوم القطع</h3>
    <small>رصيد العهد في الدفاتر يوم القطع {money(s.book['1300'] / 100)}، منها سلف بايكرية غير مستردة {money(custodyHint)} — أدخلها لأصحابها لو كانت عندهم.</small>
    {form.custody.map((c, i) => <div key={i} className="fw-form founding-row">
      <label>الاسم<input value={c.name} onChange={e => set({ custody: form.custody.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })} /></label>
      <label>المبلغ<input type="number" min="0" value={c.amount} onChange={e => set({ custody: form.custody.map((x, j) => j === i ? { ...x, amount: e.target.value } : x) })} /></label>
      <button type="button" onClick={() => set({ custody: form.custody.filter((_, j) => j !== i) })}>حذف</button>
    </div>)}
    <div className="fw-actions">
      <button type="button" onClick={() => set({ custody: [...form.custody, { name: '', amount: '' }] })}>إضافة شخص</button>
      <ConfirmButton primary label="حفظ الإعدادات والواقع" disabled={founding.busy || !form.cutoffDate}
        confirmText={actualsReady ? 'يحفظ تاريخ القطع والحد والأرقام الفعلية. لا قيود.' : 'يحفظ تاريخ القطع والحد فقط (الأرقام الفعلية ناقصة).'}
        onConfirm={() => founding.act({ action: 'saveSettings', revision, cutoffDate: form.cutoffDate, threshold: Number(form.threshold) || 0, confirm: true,
          actuals: actualsReady ? { bankOpen: form.bankOpen, bankBalance: form.bankOpen ? number(form.bankBalance) : null, cash: number(form.cash),
            custody: form.custody.filter(c => c.name.trim()).map(c => ({ name: c.name.trim(), amount: Number(c.amount) || 0 })) } : null }, 'حُفظت الإعدادات.')} />
    </div>
  </section>;
}

function DocTable({ rows, extra, head }) {
  return <div className="fw-table-scroll"><table>
    <thead><tr><th>المستند</th><th>النوع</th><th>التاريخ</th><th>المبلغ</th><th>المورد</th><th>مرحّل؟</th>{head}</tr></thead>
    <tbody>{rows.map(r => <tr key={r.key}>
      <td>{r.title}</td><td>{KIND[r.kind] || r.kind}</td><td>{day(r.date)}</td><td>{money(r.amount)}</td><td>{r.supplier || '—'}</td>
      <td>{r.protected ? 'نعم' : 'لا'}</td>{extra(r)}
    </tr>)}</tbody>
  </table></div>;
}

function Matched({ rows }) {
  return <details className="fw-panel" open={rows.length > 0}><summary>أ) مطابقة لكشف — {rows.length}</summary>
    <small>تكتمل من الكشف: جهة الدفع والتاريخ الفعلي، والسطر نفسه إثبات لما ليس له فاتورة.</small>
    {rows.length ? <DocTable rows={rows} head={<><th>الكشف</th><th>تاريخ الحركة</th></>}
      extra={r => <><td>{r.statementLine.account === 'personal' ? 'حساب هادي' : 'حساب الشركة'}</td><td>{day(r.statementLine.txDate)}</td></>} /> : <p>لا شيء مطابق بعد. ارفع كشفًا من «كشوف الحساب».</p>}
  </details>;
}

function Small({ rows, founding, threshold }) {
  const open = rows.filter(r => !r.attested);
  const total = open.reduce((n, r) => n + Number(r.amount), 0);
  return <details className="fw-panel" open={open.length > 0}><summary>ب) تحت {money(threshold)} وبدون إثبات — {rows.length}</summary>
    <small>تُقبل بإقرار المدير: يبقى المستند كما سُجّل، وتُحفظ الموافقة باسمك ووقتها. من دفعها تحسمه القاعدة الافتراضية أو استثناؤك.</small>
    {open.length > 0 && <div className="fw-actions"><ConfirmButton primary label={`قبول الكل بإقرار المدير (${open.length})`} disabled={founding.busy}
      confirmText={`يقبل ${open.length} مستندًا مجموعها ${money(total)} كما سُجّلت.`}
      onConfirm={() => founding.act({ action: 'acceptSmall', keys: open.map(r => r.key), confirm: true }, 'قُبلت بإقرار المدير.')} /></div>}
    {rows.length > 0 && <DocTable rows={rows} head={<><th>الإثبات</th><th>من دفع</th></>} extra={r => <>
      <td>{r.attested ? `مقبولة بإقرار المدير — ${r.decision?.attestedByName || r.decision?.decidedByName || ''}` : 'لم تُقبل بعد'}</td><td>{payerText(r)}</td></>} />}
  </details>;
}

function Large({ rows, founding, partners }) {
  return <details className="fw-panel" open={rows.some(r => !r.payer)}><summary>ج) فوق الحد وبدون إثبات — {rows.length}</summary>
    <small>من دفع كل مستند: القاعدة الافتراضية تنسب غير المحسوم لحسابك، وتقدر تحدد هنا غيره. «من جيب شريك» يذهب لرأس مال الشريك، و«من عهدة» لحساب العهد — بقيد مقترح ينتظر موافقتك.</small>
    {rows.length > 0 && <DocTable rows={rows} head={<><th>من دفع الآن</th><th>قرار</th></>} extra={r => <>
      <td>{payerText(r)}</td><td><DecisionPicker row={r} founding={founding} partners={partners} /></td></>} />}
  </details>;
}

function DecisionPicker({ row, founding, partners }) {
  const saved = DOC_DECISIONS[row.decision?.decision] ? row.decision.decision : '';
  const [decision, setDecision] = useState(saved), [partnerId, setPartnerId] = useState(row.decision?.partnerId || '');
  const [custodian, setCustodian] = useState(row.decision?.custodian || '');
  const changed = decision !== saved || (decision === 'partner' && partnerId !== (row.decision?.partnerId || ''))
    || (decision === 'custody' && custodian.trim() !== (row.decision?.custodian || ''));
  const incomplete = (decision === 'partner' && !partnerId) || (decision === 'custody' && !custodian.trim());
  return <span className="founding-picker">
    <select aria-label={`من أين دُفع: ${row.title}`} value={decision} onChange={e => setDecision(e.target.value)}>
      <option value="">— لم يُقرر —</option>{Object.entries(DOC_DECISIONS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
    {decision === 'partner' && <select aria-label="الشريك" value={partnerId} onChange={e => setPartnerId(e.target.value)}>
      <option value="">— الشريك —</option>{partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
    {decision === 'custody' && <input aria-label="صاحب العهدة" placeholder="اسم صاحب العهدة" value={custodian} onChange={e => setCustodian(e.target.value)} />}
    {changed && <button type="button" disabled={founding.busy || incomplete}
      onClick={() => founding.act({ action: 'decide', sourceKey: row.key, decision: decision || null, partnerId: decision === 'partner' ? partnerId : null,
        custodian: decision === 'custody' ? custodian.trim() : null, confirm: true }, 'حُفظ القرار.')}>حفظ القرار</button>}
    {!changed && saved && row.decision?.decidedByName && <small>{row.decision.decidedByName}</small>}
  </span>;
}

function Partners({ rows, founding }) {
  return <details className="fw-panel" open={rows.length > 0}><summary>د) دفعات الشركاء — {rows.length}</summary>
    <small>من أين وصلت كل دفعة؟ ما وصل لحسابك يُنقل من البنك إلى حسابك الجاري بقيد مقترح.</small>
    <div className="fw-table-scroll"><table>
      <thead><tr><th>الشريك</th><th>التاريخ</th><th>المبلغ</th><th>مرحّلة؟</th><th>وصلت إلى</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.key}><td>{r.partnerName}</td><td>{day(r.date)}</td><td>{money(r.amount)}</td><td>{r.protected ? 'نعم' : 'لا'}</td>
        <td>{r.arrivalSource === 'statement' ? `${ARRIVALS[r.arrival]} (من الكشف)` : <ArrivalPicker row={r} founding={founding} />}</td></tr>)}</tbody>
    </table></div>
  </details>;
}
function ArrivalPicker({ row, founding }) {
  const [value, setValue] = useState(row.arrival || '');
  return <span className="founding-picker">
    <select aria-label={`وصلت إلى: ${row.partnerName} ${row.date}`} value={value} onChange={e => setValue(e.target.value)}>
      <option value="">— لم يُقرر —</option>{Object.entries(ARRIVALS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
    {value !== (row.arrival || '') && <button type="button" disabled={founding.busy}
      onClick={() => founding.act({ action: 'decide', sourceKey: row.key, decision: value || null, confirm: true }, 'حُفظ القرار.')}>حفظ القرار</button>}
  </span>;
}

function Updates({ rows, founding }) {
  if (!rows.length) return null;
  const source = { rule: 'القاعدة', decision: 'قرارك', statement: 'الكشف' };
  return <details className="fw-panel" open><summary>مستندات غير مرحّلة تحتاج تحديث جهة الدفع — {rows.length}</summary>
    <small>تتعدل عبر صندوق العمل المالي نفسه (معاينة ثم حفظ بضوابطه)، وتعود «بانتظار الاعتماد». لا اعتماد ولا ترحيل.</small>
    <ul className="founding-list">{rows.map(u => <li key={u.key}>
      {u.title} · {money(u.amount)} → {payerText({ payer: u.payer, payerSource: u.source, custodian: u.patch?.custodian })}{u.source ? ` (${source[u.source] || u.source})` : ''}
      {u.held ? <StatusBadge status="held_vat" /> : u.blocked ? <StatusBadge status="blocked_period" /> : <ConfirmButton label="تطبيق" disabled={founding.busy} confirmText="يعدّل جهة الدفع في المستند فقط."
        onConfirm={() => founding.act({ action: 'applyUpdate', key: u.key, confirm: true }, 'طُبّق التحديث.')} />}
    </li>)}</ul>
  </details>;
}

function VatTouching({ rows, founding, quarters }) {
  return <details className="fw-panel" open={rows.some(r => !r.reviewed)}><summary>يمس إقرارًا مقدّمًا ({quarters.join('، ')}) — {rows.length}</summary>
    <small>مستندات انحسبت ضريبة مدخلاتها في ربع قُدّم إقراره. لا يتغير أي منها ولا يُقترح قيده للترحيل إلا بعد أن تعلّمه «راجعته».</small>
    {rows.length > 0 && <DocTable rows={rows} head={<><th>الربع</th><th>المراجعة</th></>} extra={r => <><td>{r.quarter}</td><td>{r.reviewed ? 'راجعته'
      : <ConfirmButton label="راجعته" disabled={founding.busy} confirmText="راجعت أثر التغيير على الإقرار."
        onConfirm={() => founding.act({ action: 'decide', sourceKey: r.key, vatReviewed: true, confirm: true }, 'سُجّلت المراجعة.')} />}</td></>} />}
  </details>;
}

function Entries({ plan, founding, names }) {
  const proposed = plan.entries.filter(e => e.status === 'proposed');
  const [selected, setSelected] = useState(() => new Set());
  const [reason, setReason] = useState('');
  const chosen = proposed.filter(e => selected.has(e.key));
  const s = plan.settlement;
  return <section className="fw-panel" aria-label="قيود التصحيح والتسوية">
    <h2>قيود التصحيح والتسوية</h2>
    <p>تنقل ما سُجّل على البنك (1020) أو الصندوق (1010) وهو فعليًا مرّ على حسابك إلى «حساب هادي الجاري» (2300). قيود ما قبل القطع مؤرخة بيوم القطع {day(plan.settings.cutoffDate)} لأن أشهر التأسيس الأولى مقفلة.</p>
    {plan.entries.length === 0 && <p>لا قيود مقترحة بعد: اربط الكشوف أو قرر جهات الدفع أولًا.</p>}
    {plan.entries.map(e => <article key={e.key} className="founding-entry">
      <header>
        {e.status === 'proposed' && <input type="checkbox" aria-label={`اختيار القيد: ${e.title}`} checked={selected.has(e.key)}
          onChange={() => setSelected(cur => { const next = new Set(cur); if (next.has(e.key)) next.delete(e.key); else next.add(e.key); return next; })} />}
        <strong>{e.description}</strong> <span>{day(e.date)}</span> <StatusBadge status={e.status} />{e.entryNumber ? <span>قيد رقم {e.entryNumber}</span> : null}
      </header>
      <EntryLines lines={e.lines} names={names} />
    </article>)}
    <h3>الفرق يوم القطع</h3>
    {s.status === 'needs_actuals' ? <p>أدخل الواقع يوم القطع (البنك والكاش والعهد) لحساب قيد التسوية.</p> : <div className="fw-table-scroll"><table>
      <thead><tr><th>الحساب</th><th>الدفاتر المرحّلة</th><th>بعد قيود التصحيح المقترحة</th><th>الواقع</th><th>الفرق</th></tr></thead>
      <tbody>{['1020', '1010', '1300'].map(a => <tr key={a}><td><bdi>{a}</bdi> {names?.[a]}</td><td>{money(s.book[a] / 100)}</td>
        <td>{money(s.afterCorrections[a] / 100)}</td><td>{s.actual ? money(s.actual[a] / 100) : '—'}</td><td>{s.differences ? money(s.differences[a] / 100) : '—'}</td></tr>)}</tbody>
    </table></div>}
    {s.status === 'waiting' && <p>قيد التسوية يُقترح للترحيل بعد ترحيل قيود التصحيح ({s.waitingCorrections}).</p>}
    {s.status === 'balanced' && <p>لا فرق باقٍ يوم القطع.</p>}
    <div className="fw-form">
      <label className="fw-wide">سبب الموافقة<input value={reason} onChange={e => setReason(e.target.value)} placeholder="مثلًا: مطابقة كشف هادي لفترة التأسيس" /></label>
    </div>
    <div className="fw-actions">
      <button type="button" disabled={!proposed.length} onClick={() => setSelected(new Set(proposed.map(e => e.key)))}>اختيار كل الجاهز ({proposed.length})</button>
      <ConfirmButton primary label={`موافقة وترحيل المحدد (${chosen.length})`} disabled={!chosen.length || reason.trim().length < 3 || founding.busy}
        confirmText={`يرحّل ${chosen.length} قيدًا بأسطرها المعروضة. لا يغيّر أي مستند.`}
        onConfirm={async () => { const done = await founding.act({ action: 'postEntries', reason: reason.trim(), confirm: true, entries: chosen.map(e => ({ key: e.key, hash: e.hash })) }, 'رُحّلت القيود المحددة.'); if (done) setSelected(new Set()); }} />
    </div>
  </section>;
}

function PostCutoff({ rows, cutoff }) {
  return <details className="fw-panel"><summary>بعد القطع — مستندات ناقصة لا تُعتمد — {rows.length}</summary>
    <small>بعد {day(cutoff)} لا يُعتمد مستند إلا كاملًا: المورد، والمبلغ، والإثبات (فاتورة أو سطر كشف)، والحساب المقابل. صندوق العمل المالي يرفض اعتماد الناقص.</small>
    {rows.length > 0 && <DocTable rows={rows.map(r => ({ ...r, protected: false }))} head={<th>الناقص</th>} extra={r => <td>{r.missing.join('، ')}</td>} />}
  </details>;
}
