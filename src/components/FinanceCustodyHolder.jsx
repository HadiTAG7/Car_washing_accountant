import { formatCurrency } from '../data/initialData';

/**
 * «من عهدة شخص» / «دفع موظف»: the employee whose custody pays (Cr 1300), and
 * what is left on his custody after this document. On posting the server
 * records the amount as recovered from his oldest open custody, so payroll
 * deducts only the rest; what exceeds it stays owed to him.
 */
export default function FinanceCustodyHolder({ form, detail, holders, disabled, onChange }) {
  if (!['custody', 'employee'].includes(form.fundingType)) return null;
  const list = holders || [];
  const holder = list.find(h => h.id === form.custodyBikerId);
  const stored = detail?.row?.finance_metadata?.custodian;
  const legacy = !form.custodyBikerId && stored;
  const amount = Number(form.amount) || 0, after = holder ? Math.round((holder.outstanding - amount) * 100) / 100 : 0;
  return <>
    <label>{form.fundingType === 'employee' ? 'الموظف الذي دفع' : 'صاحب العهدة'}
      <select value={form.custodyBikerId} disabled={disabled} onChange={e => onChange(e.target.value)}>
        <option value="">اختر الموظف</option>
        {list.map(h => <option key={h.id} value={h.id}>{h.name} — عهدته {formatCurrency(h.outstanding)}{h.left ? ' (انتهت خدمته)' : ''}</option>)}
        {form.custodyBikerId && !holder && <option value={form.custodyBikerId}>{stored || form.custodyBikerId}</option>}
      </select></label>
    {legacy && <p className="fw-wide fw-warning" role="note">صاحب العهدة المسجّل «{legacy}» غير مربوط بقائمة البايكرز، فلا يُخصم من عهده. اختر الموظف لربطه.</p>}
    {holder && <p className="fw-wide fw-custody-balance" role="note" aria-label="رصيد العهدة">
      {detail?.protectedSource
        ? <>سُوّي هذا المستند من عهدة {holder.name} عند ترحيله. المتبقي من عهدته الآن {formatCurrency(holder.outstanding)}.</>
        : <>عهدة {holder.name} المفتوحة {formatCurrency(holder.outstanding)} · هذا المستند {formatCurrency(amount)} · بعد الخصم <strong>{formatCurrency(Math.max(0, after))}</strong>
          {after < 0 ? `، والزائد ${formatCurrency(-after)} يبقى له ولا يُخصم من راتبه.` : '.'} القيد: مدين المصروف، دائن 1300 العهد، ويُحسب عند الترحيل استردادًا من أقدم عهده المفتوحة.</>}
    </p>}
  </>;
}
