import { useState } from 'react';
import { Gavel, Scale } from 'lucide-react';
import { ConfirmButton, EntryLines, StatusBadge } from './FoundingCommon';
import { money, day } from '../../lib/founding/foundingFormat';

const KIND = { variable: 'متغيرة', monthly: 'شهرية', annual: 'سنوية', startup: 'تأسيس' };
const ACTION = { update: 'يتعدل عبر صندوق العمل المالي', entry: 'مرحّل: قيد تصحيح بانتظار موافقتك', none: 'مرحّل بلا أثر على الصندوق أو البنك', blocked: 'في فترة مقفلة — لا يتعدل' };
const EXCEPTIONS = { partner: 'دفعها الشريك', custody: 'من عهدة', cash: 'كاش من الصندوق', unknown: 'غير معروف' };
const BATCH = 5;

/** «تطبيق القاعدة الافتراضية لفترة التأسيس»: معاينة كاملة، استثناءات، ثم تطبيق بموافقة. */
export function DefaultRule({ founding, partners, names }) {
  const { plan } = founding.data, rule = plan.rule;
  const [query, setQuery] = useState(''), [progress, setProgress] = useState(null);
  const visible = rule.candidates.filter(c => !query || `${c.title} ${c.amount} ${c.date}`.includes(query.trim()));
  async function runUpdates(keys) {
    const failed = [];
    for (let i = 0; i < keys.length; i += BATCH) {
      setProgress({ done: i, total: keys.length, failed: failed.length });
      try {
        const result = await founding.call({ action: 'applyUpdates', keys: keys.slice(i, i + BATCH), confirm: true });
        failed.push(...result.results.filter(r => !r.ok));
      } catch (error) { failed.push(...keys.slice(i, i + BATCH).map(key => ({ key, error: error.message }))); }
    }
    setProgress({ done: keys.length, total: keys.length, failed: failed.length, errors: failed.slice(0, 5) });
    founding.refresh();
  }
  async function apply() {
    const result = await founding.act({ action: 'applyRule', hash: rule.hash, confirm: true }, 'طُبّقت القاعدة. قيود المستندات المرحّلة بانتظار موافقتك في قسم القيود.');
    if (result?.updates?.length) await runUpdates(result.updates);
  }
  return <section className="fw-panel founding-rule" aria-label="القاعدة الافتراضية لفترة التأسيس">
    <h2><Gavel size={18} /> القاعدة الافتراضية لفترة التأسيس</h2>
    <p>كل مستند قبل {day(plan.settings.cutoffDate)} لم يُحسم من دفعه، وناقصه حساب التمويل أو تاريخ الدفع أو طريقة الدفع:
      حساب التمويل <strong>2300 حساب هادي الجاري</strong>، وتاريخ الدفع = تاريخ المستند، وطريقة الدفع <strong>«دفع شخصي - فترة التأسيس»</strong>.
      المرحّل لا يتعدل: يُربط بالقاعدة، ويُقترح له قيد تصحيح ينتظر موافقتك. ما يمس إقرارًا مقدّمًا يبقى محجوزًا حتى تراجعه.</p>
    {rule.applied && <p role="status" className="fw-success">طُبّقت على {rule.applied.count} مستندًا ({money(rule.applied.total)}) — {rule.applied.byName}، {rule.applied.atIso.slice(0, 16).replace('T', ' ')}.</p>}
    {rule.pendingUpdates.length > 0 && !progress && <div className="fw-warning" role="status">
      <span>{rule.pendingUpdates.length} مستندًا غير مرحّل تحت القاعدة لم يتعدل بعد.</span>
      <ConfirmButton label="تطبيق المتبقي" confirmText="يعدّل جهة الدفع وتاريخه في هذه المستندات فقط عبر صندوق العمل المالي." disabled={founding.busy}
        onConfirm={() => runUpdates(rule.pendingUpdates)} />
    </div>}
    {progress && <p role="status" aria-label="تقدم التعديل">تعديل المستندات غير المرحّلة: {progress.done} من {progress.total}{progress.failed ? ` · تعذّر ${progress.failed}` : ''}
      {progress.errors?.map(e => <small key={e.key} className="founding-error">{e.key}: {e.error}</small>)}</p>}
    {rule.count === 0 ? <p>لا مستندات تنطبق عليها القاعدة الآن.</p> : <>
      <div className="fw-metrics">
        <div className="fw-panel fw-metric"><span>المستندات</span><strong>{rule.count}</strong><p>{money(rule.total)}</p></div>
        <div className="fw-panel fw-metric"><span>غير مرحّلة — تتعدل</span><strong>{rule.unposted.count}</strong><p>{money(rule.unposted.amount)}</p></div>
        <div className="fw-panel fw-metric"><span>مرحّلة — بقيد تصحيح</span><strong>{rule.posted.count}</strong><p>{money(rule.posted.amount)}</p></div>
        <div className="fw-panel fw-metric"><span>تمس إقرارًا مقدّمًا</span><strong>{rule.held}</strong><p>محجوزة حتى المراجعة{rule.blocked ? ` · ${rule.blocked} في فترة مقفلة` : ''}</p></div>
      </div>
      <details className="fw-form-section" open>
        <summary>المستندات ({rule.count}) — حدّد الاستثناءات قبل التطبيق</summary>
        <label className="founding-search">بحث<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="الوصف أو المبلغ أو التاريخ" /></label>
        <div className="fw-table-scroll"><table>
          <thead><tr><th>المستند</th><th>النوع</th><th>التاريخ</th><th>المبلغ</th><th>ناقصه</th><th>ماذا سيحدث</th><th>استثناء</th></tr></thead>
          <tbody>{visible.map(c => <tr key={c.key}>
            <td>{c.title}</td><td>{KIND[c.kind] || c.kind}</td><td>{day(c.date)}</td><td>{money(c.amount)}</td><td>{c.gaps.join('، ')}</td>
            <td>{ACTION[c.action]}{c.vatHeld ? <><br /><StatusBadge status="held_vat" /></> : null}</td>
            <td><ExceptionPicker sourceKey={c.key} title={c.title} founding={founding} partners={partners} /></td>
          </tr>)}</tbody>
        </table></div>
      </details>
      <details className="fw-form-section">
        <summary>القيود المقترحة ({rule.entries.length}) — بأسطرها</summary>
        <h3>مجموع الأسطر حسب الحساب</h3>
        <EntryLines lines={rule.lines.map(l => ({ ...l, description: 'مجموع' }))} names={names} />
        {rule.entries.map(e => <article key={e.key} className="founding-entry">
          <header><strong>{e.description}</strong> <span>{day(e.date)}</span> <StatusBadge status={e.status} /></header>
          <EntryLines lines={e.lines} names={names} />
        </article>)}
      </details>
      <div className="fw-actions">
        <ConfirmButton primary label={`تطبيق القاعدة على ${rule.count} مستندًا`} disabled={founding.busy || Boolean(progress && progress.done < progress.total)}
          confirmText={`يحفظ أن دافع ${rule.count} مستندًا (${money(rule.total)}) هو هادي باسمك ووقتك، ويعدّل ${rule.unposted.count - rule.blocked} مستندًا غير مرحّل عبر صندوق العمل المالي. قيود المرحّلة (${rule.entries.length}) تنتظر موافقتك. لا ترحيل.`}
          onConfirm={apply} />
      </div>
    </>}
    <Exceptions rows={plan.exceptions} founding={founding} />
  </section>;
}

/** «دفعها الشريك فلان» أو «من عهدة فلان» (أو كاش / غير معروف) لمستند بعينه — قبل تطبيق القاعدة. */
export function ExceptionPicker({ sourceKey, title, founding, partners }) {
  const [kind, setKind] = useState(''), [partnerId, setPartnerId] = useState(''), [custodian, setCustodian] = useState('');
  const ready = kind && (kind !== 'partner' || partnerId) && (kind !== 'custody' || custodian.trim());
  return <span className="founding-picker">
    <select aria-label={`استثناء: ${title}`} value={kind} onChange={e => setKind(e.target.value)}>
      <option value="">— القاعدة (دفع شخصي) —</option>{Object.entries(EXCEPTIONS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
    {kind === 'partner' && <select aria-label="الشريك" value={partnerId} onChange={e => setPartnerId(e.target.value)}>
      <option value="">— الشريك —</option>{partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
    {kind === 'custody' && <input aria-label="صاحب العهدة" placeholder="اسم صاحب العهدة" value={custodian} onChange={e => setCustodian(e.target.value)} />}
    {ready && <button type="button" disabled={founding.busy} onClick={() => founding.act({ action: 'decide', sourceKey, decision: kind,
      partnerId: kind === 'partner' ? partnerId : null, custodian: kind === 'custody' ? custodian.trim() : null, confirm: true }, 'حُفظ الاستثناء.')}>حفظ الاستثناء</button>}
  </span>;
}

function Exceptions({ rows, founding }) {
  if (!rows.length) return null;
  const label = r => r.payer === 'partner' ? `دفعها الشريك ${r.partnerName}` : r.payer === 'custody' ? `من عهدة ${r.custodian}`
    : r.payer === 'hadi' ? 'من حسابي' : r.payer === 'cash' ? 'كاش من الصندوق' : 'غير معروف';
  return <details className="fw-form-section"><summary>الاستثناءات والقرارات المحفوظة ({rows.length})</summary>
    <div className="fw-table-scroll"><table>
      <thead><tr><th>المستند</th><th>التاريخ</th><th>المبلغ</th><th>من دفع</th><th>قرره</th><th></th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.key}><td>{r.title}</td><td>{day(r.date)}</td><td>{money(r.amount)}</td><td>{label(r)}</td><td>{r.decidedByName || '—'}</td>
        <td><ConfirmButton label="إلغاء" confirmText="يرجع المستند للقاعدة الافتراضية." disabled={founding.busy}
          onConfirm={() => founding.act({ action: 'decide', sourceKey: r.key, decision: null, confirm: true }, 'أُلغي الاستثناء.')} /></td></tr>)}</tbody>
    </table></div>
  </details>;
}

/** رصيد حساب هادي الجاري حسب المستندات مقابل سطور كشفه المعلّمة، وقيد الفرق على 3200. */
export function StatementComparison({ plan, names }) {
  const c = plan.comparison;
  const owed = value => value >= 0 ? `المشروع مدين لهادي بـ ${money(value)}` : `عند هادي للمشروع ${money(-value)}`;
  return <section className="fw-panel" aria-label="الحساب الجاري مقابل كشفك">
    <h2><Scale size={18} /> حسابك الجاري حسب المستندات مقابل كشفك (قبل {day(c.cutoffDate)})</h2>
    <div className="fw-table-scroll"><table>
      <tbody>
        <tr><th scope="row">مستندات دفعتها (بالقاعدة أو الكشف أو قرارك)</th><td>{money(c.paid)}</td></tr>
        <tr><th scope="row">تحويلات بينك وبين حساب الشركة (صافي)</th><td>{money(c.transfers)}</td></tr>
        <tr><th scope="row">دفعات شركاء وصلتك</th><td>−{money(c.received)}</td></tr>
        <tr><th scope="row">حسب المستندات</th><td><strong>{money(c.byDocuments)}</strong> · {owed(c.byDocuments)}</td></tr>
        <tr><th scope="row">سطور كشفك المعلّمة ({c.statementLines})</th><td>خرج {money(c.statementOut)} − دخل {money(c.statementIn)} = <strong>{money(c.byStatement)}</strong></td></tr>
        <tr><th scope="row">الفرق</th><td><strong>{money(c.difference)}</strong></td></tr>
      </tbody>
    </table></div>
    {c.status === 'needs_statement' && <p>ارفع كشفك الشخصي من «كشوف الحساب» وعلّم سطور المشروع، ثم يُقترح قيد الفرق.</p>}
    {c.status === 'balanced' && <p>لا فرق: المستندات تطابق كشفك.</p>}
    {c.entry && <article className="founding-entry">
      <header><strong>{c.entry.description}</strong> <span>{day(c.entry.date)}</span> <StatusBadge status={c.entry.status} /></header>
      <EntryLines lines={c.entry.lines} names={names} />
      {c.entry.status === 'proposed' && <small>يُرحّل من قسم «قيود التصحيح والتسوية» بموافقتك فقط.</small>}
    </article>}
  </section>;
}
