import { useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { money } from '../../lib/founding/foundingFormat';

/** Two clicks for anything that saves: the first only asks. */
export function ConfirmButton({ label, confirmText, onConfirm, disabled, primary = false }) {
  const [asking, setAsking] = useState(false);
  if (!asking) return <button type="button" className={primary ? 'fw-primary' : ''} disabled={disabled} onClick={() => setAsking(true)}>{label}</button>;
  return <span className="founding-confirm" role="group" aria-label={label}>
    <span>{confirmText}</span>
    <button type="button" className="fw-primary" disabled={disabled} onClick={async () => { await onConfirm(); setAsking(false); }}>تأكيد</button>
    <button type="button" disabled={disabled} onClick={() => setAsking(false)}>إلغاء</button>
  </span>;
}

export function Messages({ error, actionError, notice }) {
  return <>
    {error && <div role="alert" className="fw-warning"><AlertTriangle size={18} />{error}</div>}
    {actionError && <div role="alert" className="fw-warning"><AlertTriangle size={18} />{actionError}</div>}
    {notice && <div role="status" className="fw-success"><CheckCircle2 size={16} /> {notice}</div>}
  </>;
}

const STATUS = {
  proposed: 'بانتظار موافقتك', posted: 'مرحّل', held_vat: 'يمس إقرارًا مقدّمًا — راجعه أولًا',
  blocked_period: 'الفترة مقفلة', waiting: 'بعد ترحيل قيود التصحيح', unposted: 'لم يُرحّل بعد',
};
export function StatusBadge({ status }) {
  return <span className={`fw-badge founding-status founding-status--${status}`}>{STATUS[status] || status}</span>;
}

export function EntryLines({ lines, names }) {
  return <div className="fw-table-scroll"><table>
    <thead><tr><th>الحساب</th><th>البيان</th><th>مدين</th><th>دائن</th></tr></thead>
    <tbody>{lines.map((l, i) => <tr key={i}>
      <td><bdi>{l.accountId}</bdi> {names?.[l.accountId] || ''}</td><td>{l.description}</td>
      <td>{l.debit ? money(l.debit) : ''}</td><td>{l.credit ? money(l.credit) : ''}</td>
    </tr>)}</tbody>
  </table></div>;
}
