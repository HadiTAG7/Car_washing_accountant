import { RefreshCw, Wallet } from 'lucide-react';
import TopBar from './TopBar';
import LoadingState from './LoadingState';
import { useFounding } from '../hooks/useFounding';
import { ConfirmButton, Messages, StatusBadge } from './founding/FoundingCommon';
import { meaningText, money, day, balanceShort } from '../lib/founding/foundingFormat';
import './FinanceWorkspace.css';
import './founding/Founding.css';

/** كشف حساب هادي الجاري مع المشروع: كل حركة، والرصيد، ومعناه. */
export default function HadiCurrentAccountPage() {
  const founding = useFounding();
  const data = founding.data, hadi = data?.plan?.hadi;
  if (!founding.allowed) return <div className="fw-page"><p role="alert">حساب هادي الجاري للإدارة فقط.</p></div>;
  return <>
    <TopBar title="حساب هادي الجاري" subtitle="حساب وسيط بين هادي والمشروع — لا بنك ولا صندوق" />
    <main className="fw-page founding-page" dir="rtl">
      <div className="fw-toolbar">
        <p>ما دفعه هادي من حسابه الشخصي للمشروع يزيد ما على المشروع له، وما استلمه للمشروع (مثل دفعات الشركاء) يزيد ما عنده للمشروع.</p>
        <button type="button" onClick={founding.refresh}><RefreshCw size={16} /> تحديث القراءة</button>
      </div>
      <Messages error={founding.error} actionError={founding.actionError} notice={founding.notice} />
      {founding.loading && <LoadingState message="جارٍ قراءة حساب هادي الجاري..." />}
      {data && !data.accounts.hadi && <div className="fw-warning" role="status">
        <span>الحساب 2300 «حساب هادي الجاري مع المشروع» غير موجود في دليل الحسابات بعد (ومعه 3200 «تسويات فترة التأسيس»). يُضاف تلقائيًا مع أول تطبيق من كشف هادي، أو الآن:</span>
        <ConfirmButton label="إضافة الحسابين إلى الدليل" confirmText="يضيف الحسابين 2300 و3200 فقط، بلا قيود." disabled={founding.busy}
          onConfirm={() => founding.act({ action: 'ensureAccounts', confirm: true }, 'أُضيف الحسابان إلى الدليل.')} />
      </div>}
      {hadi && <>
        <section className="founding-meaning fw-panel" aria-label="معنى الرصيد">
          <Wallet size={22} />
          <div>
            <strong>{meaningText(hadi.meaning)}</strong>
            <small>حسب القيود المرحّلة. الرصيد الدائن = المشروع مدين لهادي، والمدين = عند هادي للمشروع.</small>
            {hadi.pending.length > 0 && <p>بعد الحركات التي لم تُرحّل بعد ({hadi.pending.length}): <strong>{meaningText(hadi.projectedMeaning)}</strong></p>}
          </div>
        </section>
        <div className="fw-metrics">
          <div className="fw-panel fw-metric"><span>الرصيد المرحّل</span><strong>{balanceShort(hadi.postedBalance)}</strong><p>{hadi.posted.length} حركة مرحّلة</p></div>
          <div className="fw-panel fw-metric"><span>بعد الحركات المعلّقة</span><strong>{balanceShort(hadi.projectedBalance)}</strong><p>{hadi.pending.length} حركة بانتظار الاعتماد أو موافقتك</p></div>
        </div>
        <section className="fw-panel" aria-label="الحركات المرحّلة">
          <h2>الحركات المرحّلة</h2>
          {hadi.posted.length === 0 ? <p>لا حركات مرحّلة على الحساب بعد.</p> : <MovementTable rows={hadi.posted} running />}
        </section>
        <section className="fw-panel" aria-label="حركات لم تُرحّل بعد">
          <h2>لم تُرحّل بعد</h2>
          <small>مصاريف دفعها هادي ولم تُعتمد وتُرحّل من صندوق العمل المالي، وقيود مقترحة بانتظار موافقتك في «تسوية فترة التأسيس».</small>
          {hadi.pending.length === 0 ? <p>لا شيء معلّق.</p> : <MovementTable rows={hadi.pending} />}
        </section>
      </>}
      <div className="fw-actions">
        <a className="underline" href="?page=bank_statements">رفع كشف حساب</a>
        <a className="underline" href="?page=founding_settlement">تسوية فترة التأسيس</a>
      </div>
    </main>
  </>;
}

function MovementTable({ rows, running = false }) {
  return <div className="fw-table-scroll"><table>
    <thead><tr><th>التاريخ</th><th>الحركة</th><th>البيان</th>{running ? <th>رقم القيد</th> : <th>الحالة</th>}
      <th>لهادي على المشروع</th><th>على هادي للمشروع</th>{running && <th>الرصيد</th>}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={`${r.entryId || r.key}-${i}`}>
      <td>{day(r.date)}</td><td>{r.label}</td><td>{r.description}{r.lineDescription && r.lineDescription !== r.description ? ` — ${r.lineDescription}` : ''}</td>
      {running ? <td>{r.entryNumber ?? '—'}</td> : <td><StatusBadge status={r.status} /></td>}
      <td>{Number(r.credit) ? money(r.credit) : ''}</td><td>{Number(r.debit) ? money(r.debit) : ''}</td>
      {running && <td>{balanceShort(r.balance)}</td>}
    </tr>)}</tbody>
  </table></div>;
}
