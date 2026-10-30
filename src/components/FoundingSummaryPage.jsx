import { Printer, RefreshCw } from 'lucide-react';
import TopBar from './TopBar';
import LoadingState from './LoadingState';
import { useFounding } from '../hooks/useFounding';
import { Messages } from './founding/FoundingCommon';
import { money, day, when, meaningText, TRANSFER_SOURCE as SOURCE } from '../lib/founding/foundingFormat';
import './FinanceWorkspace.css';
import './founding/Founding.css';

const KIND = { variable: 'متغيرة', monthly: 'شهرية', annual: 'سنوية', startup: 'تأسيس' };
const STATUS = { posted: 'مرحّل', proposed: 'مقترح — لم يُرحّل', held_vat: 'محجوز (إقرار مقدّم)', blocked_period: 'الفترة مقفلة', waiting: 'بعد ترحيل التصحيحات' };

/** ملخص فترة التأسيس للشركاء: للقراءة والطباعة فقط، من نفس حساب صفحة التسوية. */
export default function FoundingSummaryPage() {
  const founding = useFounding();
  const data = founding.data, s = data?.plan?.summary;
  if (!founding.allowed) return <div className="fw-page"><p role="alert">ملخص فترة التأسيس للإدارة فقط.</p></div>;
  return <>
    <TopBar title="ملخص فترة التأسيس" subtitle="للشركاء — للقراءة والطباعة" />
    <main className="fw-page founding-page" dir="rtl">
      <div className="fw-toolbar">
        <p>للقراءة فقط: لا شيء هنا يحفظ أو يغيّر. الأرقام من نفس حساب «تسوية فترة التأسيس» لحظة القراءة.</p>
        <span className="fw-actions">
          <button type="button" onClick={founding.refresh}><RefreshCw size={16} /> تحديث القراءة</button>
          <button type="button" className="fw-primary" disabled={!s} onClick={() => window.print()}><Printer size={16} /> طباعة</button>
        </span>
      </div>
      <Messages error={founding.error} />
      {founding.loading && <LoadingState message="جارٍ إعداد الملخص..." />}
      {s && <Summary s={s} readAt={data.readAt} />}
    </main>
  </>;
}

function Summary({ s, readAt }) {
  const b = s.balance;
  const partnerTotals = ['hadi', 'company', 'undecided'].map(k => s.partners.reduce((n, p) => n + p[k], 0));
  return <article id="founding-summary-sheet" className="founding-summary" aria-label="ملخص فترة التأسيس">
    <header>
      <h1>ملخص فترة التأسيس</h1>
      <p>من البداية حتى {day(s.foundingEnd)} — بدأ حساب البنك {day(s.cutoffDate)}. أُعدّ <bdi>{when(readAt)}</bdi>.</p>
    </header>

    <section aria-label="رأس المال المستلم من الشركاء">
      <h2>1. رأس المال المستلم من الشركاء — ووين وصل</h2>
      {s.partners.length === 0 ? <p>لا دفعات شركاء قبل {day(s.cutoffDate)}.</p> : <div className="fw-table-scroll"><table>
        <thead><tr><th>الشريك</th><th>الدفعات</th><th>المجموع</th><th>وصل لحساب هادي</th><th>وصل لحساب الشركة</th><th>لم تُحسم وجهته</th></tr></thead>
        <tbody>{s.partners.map(p => <tr key={p.partnerId}><td>{p.name}</td><td>{p.count}</td><td>{money(p.total)}</td><td>{money(p.hadi)}</td>
          <td>{money(p.company)}</td><td>{money(p.undecided)}</td></tr>)}</tbody>
        <tfoot><tr><th scope="row">المجموع</th><td>{s.partners.reduce((n, p) => n + p.count, 0)}</td><td>{money(s.partnersTotal)}</td>
          {partnerTotals.map((v, i) => <td key={i}>{money(v)}</td>)}</tr></tfoot>
      </table></div>}
      {s.afterCutoff.count > 0 && <small>بعد بدء البنك: {s.afterCutoff.count} دفعة · {money(s.afterCutoff.amount)} (خارج هذا الملخص).</small>}
    </section>

    <section aria-label="المصروف الموثّق حسب التصنيف">
      <h2>2. المصروف الموثّق حسب التصنيف</h2>
      {s.categories.length === 0 ? <p>لا مصاريف مسجّلة في فترة التأسيس.</p> : <div className="fw-table-scroll"><table>
        <thead><tr><th>النوع</th><th>التصنيف</th><th>العدد</th><th>المجموع</th><th>منه دفعه هادي</th></tr></thead>
        <tbody>{s.categories.map(c => <tr key={`${c.kind}|${c.category}`}><td>{KIND[c.kind] || c.kind}</td><td>{c.category || 'بلا تصنيف'}</td>
          <td>{c.count}</td><td>{money(c.amount)}</td><td>{money(c.byHadi)}</td></tr>)}</tbody>
        <tfoot><tr><th scope="row" colSpan={2}>المجموع</th><td>{s.documented.count}</td><td>{money(s.documented.amount)}</td>
          <td>{money(s.categories.reduce((n, c) => n + c.byHadi, 0))}</td></tr></tfoot>
      </table></div>}
      {s.cancelled?.count > 0 && <p>استُبعد {s.cancelled.count} مستند ملغى لأنه مكرر ({money(s.cancelled.amount)}): {s.cancelled.rows.map(d => `«${d.title}» مكرر لـ«${d.originalTitle || d.originalKey}»`).join('، ')}.</p>}
    </section>

    <section aria-label="مصاريف بإقرار المدير">
      <h2>3. مصاريف بإقرار المدير (بلا مستند)</h2>
      <p>{s.attested.count} مصروف · {money(s.attested.amount)} — دفعها هادي ولا مستند لها، مسجّلة بإقراره واسمه، بلا ضريبة مدخلات.</p>
      <AttestedList summary={s} />
    </section>

    <section aria-label="ما انحوّل لحساب الشركة">
      <h2>4. ما انحوّل لحساب الشركة</h2>
      {s.transfers.length === 0 ? <p>لا تحويلات لحساب الشركة بعد (من كشف أو بلا كشف).</p> : <div className="fw-table-scroll"><table>
        <thead><tr><th>التاريخ</th><th>البيان</th><th>المصدر</th><th>الاتجاه</th><th>المبلغ</th></tr></thead>
        <tbody>{s.transfers.map(t => <tr key={t.key}><td>{day(t.date)}</td><td>{t.title}</td><td>{SOURCE[t.account] || t.account}{t.status !== 'posted' ? ' — لم يُرحّل' : ''}</td>
          <td>{t.toCompany ? 'من هادي لحساب الشركة' : 'من حساب الشركة لهادي'}</td>
          <td>{money(t.amount)}</td></tr>)}</tbody>
        <tfoot><tr><th scope="row" colSpan={4}>صافي ما انحوّل لحساب الشركة</th><td>{money(b.toCompany - b.toHadi)}</td></tr></tfoot>
      </table></div>}
    </section>

    <section aria-label="رصيد حساب هادي الجاري">
      <h2>5. رصيد حساب هادي الجاري (2300)</h2>
      <div className="fw-table-scroll"><table><tbody>
        <tr><th scope="row">مستندات دفعها هادي ({b.paidCount})</th><td>{money(b.paid)}</td></tr>
        <tr><th scope="row">دفعات شركاء وصلت لحسابه ({b.receivedCount})</th><td>{money(-b.received)}</td></tr>
        <tr><th scope="row">تحويلاته لحساب الشركة</th><td>{money(b.toCompany - b.toHadi)}</td></tr>
        <tr><th scope="row">الصافي</th><td><strong>{money(b.net)}</strong> · {meaningText(b.meaning)}</td></tr>
        {b.adjustments !== 0 && <tr><th scope="row">بعد التسويات على 3200</th><td><strong>{money(b.afterAdjustments)}</strong> · {meaningText(b.afterMeaning)}</td></tr>}
      </tbody></table></div>
      {b.undecided.count > 0 && <p>دفعات شركاء لم تُحسم وجهتها بعد: {b.undecided.count} · {money(b.undecided.amount)} — لا تدخل الصافي.</p>}
      <p>{b.attestation ? <>اعتمده {b.attestation.byName} بإقرار المدير <bdi>{when(b.attestation.atIso)}</bdi>: «{b.attestation.note}»{b.attestation.changed ? ' — تغيّر الرصيد بعد الاعتماد.' : '.'}</>
        : 'لم يُعتمد الرصيد بإقرار المدير بعد.'}</p>
    </section>

    <section aria-label="التسويات على 3200">
      <h2>6. التسويات على 3200 تسويات فترة التأسيس</h2>
      {s.settlements.length === 0 ? <p>لا تسويات على 3200.</p> : <div className="fw-table-scroll"><table>
        <thead><tr><th>البيان</th><th>التاريخ</th><th>المبلغ</th><th>الحالة</th><th>السبب</th><th>وافق عليه</th></tr></thead>
        <tbody>{s.settlements.map(e => <tr key={e.key}><td>{e.title}</td><td>{day(e.date)}</td><td>{money(e.amount)}</td>
          <td>{STATUS[e.status] || e.status}{e.entryNumber ? ` (قيد ${e.entryNumber})` : ''}</td><td>{e.reason || '—'}</td><td>{e.approvedByName || '—'}</td></tr>)}</tbody>
      </table></div>}
      <small>موجب: إلى 3200. سالب: منه.</small>
    </section>
  </article>;
}

function AttestedList({ summary }) {
  const rows = summary.attestedRows || [];
  if (!rows.length) return null;
  return <div className="fw-table-scroll"><table>
    <thead><tr><th>التاريخ التقريبي</th><th>الوصف</th><th>التصنيف</th><th>المبلغ</th><th>أقرّه</th></tr></thead>
    <tbody>{rows.map(e => <tr key={e.key}><td>{day(e.approxDate)}</td><td>{e.title}</td><td>{KIND[e.kind]}{e.category ? ` — ${e.category}` : ''}</td>
      <td>{money(e.amount)}</td><td>{e.byName}</td></tr>)}</tbody>
  </table></div>;
}
