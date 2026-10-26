import { X } from 'lucide-react';
import ModalSurface from './ModalSurface';
import { displayBikerName } from '../lib/bikerNames';
import { formatCurrencyPrecise } from '../data/initialData';

export default function OverviewDeductionsDetails({ sweater, renderItem, sourceTime, records = [], recordsUnavailable, bikers = [],
  periodKey, language, noSweater, onNavigate, onClose }) {
  const text = (ar, en) => language === 'en' ? en : ar;
  const status = { approved: text('معتمد', 'Approved'), pending_review: text('بانتظار المراجعة', 'Pending review'), disputed: text('محل اعتراض', 'Disputed') };
  const kinds = { operational_or_traffic_violation: text('مخالفة', 'Violation'), proven_damage: text('ضرر', 'Damage'), customer_compensation: text('تعويض عميل', 'Customer compensation') };
  const sourceKinds = {
    'Biker Inactivity for 3 Consecutive Days Without a Replacement': text('انقطاع 3 أيام متتالية دون بديل، بحسب سويتر', 'Three consecutive days inactive without a replacement, according to Sweater'),
    'Loss or Damage of Tools and Materials': text('فقد أو تلف أدوات ومواد', 'Loss or damage of tools and materials'),
    'Damaged Motorcycle Stickers': text('تلف ملصقات الدباب', 'Damaged motorcycle stickers'),
  };
  const sourceRows = Object.values(sweater?.deductionDetails || {}).flat().sort((a, b) => b.date.localeCompare(a.date) || b.sourceId.localeCompare(a.sourceId));
  const byBiker = new Map();
  for (const row of sourceRows) {
    const group = byBiker.get(row.driverExternalId) || { driverExternalId: row.driverExternalId, halalas: 0, count: 0 };
    group.halalas += Math.round(row.amount * 100); group.count += 1; byBiker.set(row.driverExternalId, group);
  }
  const groups = [...byBiker.values()].sort((a, b) => b.halalas - a.halalas || a.driverExternalId.localeCompare(b.driverExternalId));
  const incomplete = sweater?.deductions.some(item => item.unit === 'sar' && item.value > 0 && !Object.hasOwn(sweater.deductionDetails || {}, item.key));
  const name = row => {
    const matches = bikers.filter(biker => row.driverExternalId && biker.driverExternalId === row.driverExternalId);
    return row.driverName || (matches.length === 1 ? displayBikerName(matches[0], language) : text('البايكر غير محدد في السجل', 'Biker not identified in the record'));
  };
  return <ModalSurface className="sw-overview-detail-surface" onClose={onClose}><section className="sw-overview-detail" dir={language === 'en' ? 'ltr' : 'rtl'}>
    <header><h2>{text('تفاصيل الخصومات والتعويضات', 'Deduction and compensation details')}</h2>
      <button type="button" aria-label={text('إغلاق التفاصيل', 'Close details')} onClick={onClose}><X size={20} /></button></header>
    <p><bdi>{periodKey}</bdi> · {text('المصدر: لوحة التعويضات وسجلات المخالفات في سويتر', 'Source: Sweater’s Compensations dashboard and violation records')}</p>
    {sourceTime && <p>{sourceTime}</p>}
    <p>{text('إجمالي الخصومات بالريال', 'Total monetary deductions')}: <strong><bdi>{sweater?.deductionMoney == null ? noSweater : formatCurrencyPrecise(sweater.deductionMoney)}</bdi></strong></p>
    <h3>{text('من البايكر المرتبط بالخصم؟', 'Which biker is linked to the deduction?')}</h3>
    {!sourceRows.length ? <p role="status">{text('لقطة سويتر الحالية تحفظ الإجماليات فقط، دون أسماء أو حجوزات تفسّر كل خصم. لا ننسب المبلغ لبايكر بالتخمين.', 'The current Sweater snapshot stores totals only, without names or bookings explaining each deduction. No amount is attributed by guesswork.')}</p>
      : <>
        <p>{text('الأسماء من سجل البايكرية، والإسناد والمبالغ والأسباب من سجلات سويتر. هذا ليس خصمًا معتمدًا من الراتب.', 'Names come from the biker register; attribution, amounts and reasons come from Sweater records. This is not an approved payroll deduction.')}</p>
        <div className="sw-overview-detail__table"><table aria-label={text('الخصومات حسب البايكر', 'Deductions by biker')}><thead><tr>
          {[text('البايكر', 'Biker'), text('المبلغ المفصل', 'Itemized amount'), text('عدد السجلات', 'Record count')].map(label => <th key={label} scope="col">{label}</th>)}
        </tr></thead><tbody>{groups.map(group => <tr key={group.driverExternalId}><th scope="row"><span translate="no">{name(group)}</span><small><bdi>{group.driverExternalId}</bdi></small></th>
          <td><bdi>{formatCurrencyPrecise(group.halalas / 100)}</bdi></td><td><bdi>{group.count}</bdi></td></tr>)}</tbody></table></div>
        {incomplete && <p role="status">{text('بعض أنواع الخصم بلا تفاصيل أسماء؛ المبالغ غير المفصلة لا تُوزّع على البايكرية.', 'Some deduction types have no biker details; unitemized amounts are not allocated to bikers.')}</p>}
        <details className="sw-overview-detail__source-records"><summary>{text('عرض كل مخالفة وسببها', 'View each violation and its reason')}</summary>
          <ol aria-label={text('سجلات الخصم من سويتر', 'Sweater deduction records')}>{sourceRows.map(row => <li key={`${row.metricKey}:${row.sourceId}`}>
            <div><strong translate="no">{name(row)}</strong><bdi>{formatCurrencyPrecise(row.amount)}</bdi></div>
            <small><bdi>{row.date}</bdi> · <bdi>{row.driverExternalId}</bdi></small>
            <p>{sourceKinds[row.category] || row.category}</p>
            {row.bookingId && <small>{text('الحجز', 'Booking')}: <bdi>{row.bookingId}</bdi></small>}
            <a href={row.sourceUrl} target="_blank" rel="noopener noreferrer">{text('فتح سجل سويتر', 'Open Sweater record')} <bdi>{row.sourceId}</bdi></a>
          </li>)}</ol>
        </details>
      </>}
    {sweater && <>
      <h3>{text('الخصومات', 'Deductions')}</h3><ul className="sw-overview-insight__items">{sweater.deductions.map(renderItem)}</ul>
      <h3>{text('الإضافات', 'Additions')}</h3><ul className="sw-overview-insight__items">{sweater.additions.map(renderItem)}</ul>
      <p>{text('المخالفات والأضرار والتعويضات بالريال. بقية البنود أعداد، ولا تدخل في إجمالي المبلغ.', 'Violations, damages and compensation are in SAR. Other items are counts and are excluded from the monetary total.')}</p>
    </>}
    <h3>{text('الخصومات المسجلة في النظام', 'Deductions recorded in the system')}</h3>
    {recordsUnavailable ? <p>{text('قراءة سجلات الخصم غير متاحة؛ لا يعني ذلك عدم وجود خصومات.', 'Deduction records are unavailable; this does not mean there are none.')}</p>
      : !records.length ? <p>{text('لا توجد سجلات خصم مفصلة لهذا الشهر في النظام.', 'No itemized deduction records exist for this month in the system.')}</p>
        : <div className="sw-overview-detail__table"><table><thead><tr>{[
          text('البايكر المسجل', 'Recorded biker'), text('النوع', 'Type'), text('المبلغ', 'Amount'), text('التاريخ والحجز', 'Date and booking'), text('الحالة', 'Status'),
        ].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{records.map(row => <tr key={row.id}>
          <th scope="row"><span translate="no">{name(row)}</span>{row.driverExternalId && <small><bdi>{row.driverExternalId}</bdi></small>}</th>
          <td>{kinds[row.typeKey] || text('خصم مسجل', 'Recorded deduction')}</td><td><bdi>{formatCurrencyPrecise(row.amount)}</bdi></td>
          <td><bdi>{row.effectiveDate}</bdi>{(row.sspBookingId || row.bookingId) && <small><bdi>{row.sspBookingId || row.bookingId}</bdi></small>}</td>
          <td>{status[row.approvalStatus] || text('غير محددة', 'Unspecified')}</td>
        </tr>)}</tbody></table></div>}
    <p>{text('السجل المرتبط باسم لا يثبت وحده مسؤولية البايكر، والمعلّق لا يدخل في المعتمد.', 'A named record alone does not establish responsibility; pending items are excluded from approved amounts.')}</p>
    {onNavigate && <button type="button" className="sw-overview__link" onClick={() => { onClose(); onNavigate('sweater_settlements'); }}>{text('تفاصيل تسويات سويتر', 'Sweater settlement details')}</button>}
  </section></ModalSurface>;
}
