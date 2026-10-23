import { X } from 'lucide-react';
import ModalSurface from './ModalSurface';
import { overviewBikerCapacity } from '../lib/overviewBikerCapacity';
import { validTipsByBiker } from '../../functions/src/sweater/metricsContract';
import { displayBikerName } from '../lib/bikerNames';
import { formatCurrencyPrecise, formatNumber } from '../data/initialData';

export default function OverviewBikerDetails({ kind, ops, bikers = [], snapshot, periodKey, language, onClose }) {
  const text = (ar, en) => language === 'en' ? en : ar;
  const num = value => value == null ? '—' : formatNumber(Math.round(value * 100) / 100);
  const capacity = kind === 'capacity' ? overviewBikerCapacity(ops, bikers) : null;
  const tips = snapshot?.periodKey === periodKey && validTipsByBiker(snapshot.tipsByBiker, snapshot.metrics?.tipsNet)
    ? snapshot.tipsByBiker.filter(row => row.netAmount !== 0) : null;
  const name = biker => biker ? displayBikerName(biker, language) : text('الاسم غير مربوط', 'Name not linked');
  const sourceTime = snapshot?.metricSources?.tipsNet?.extractedAtIso || snapshot?.extractedAtIso;
  const updated = sourceTime && Number.isFinite(Date.parse(sourceTime)) ? new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'ar-SA-u-ca-gregory',
    { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Riyadh', numberingSystem: 'latn' }).format(new Date(sourceTime)) : null;
  return <ModalSurface onClose={onClose}><section className="sw-overview-detail" dir={language === 'en' ? 'ltr' : 'rtl'}>
    <header><h2>{kind === 'capacity' ? text('نسبة الإنتاج لكل بايكر', 'Output percentage per biker') : text('البايكرز المسجل لهم بقشيش', 'Bikers with recorded tips')}</h2>
      <button type="button" aria-label={text('إغلاق التفاصيل', 'Close details')} onClick={onClose}><X size={20} /></button></header>
    <p><bdi>{periodKey}</bdi></p>
    {kind === 'capacity' ? <>
      <p>{text('غسلات البايكر ÷ أيام غسيله المكتملة ÷ الطاقة اليومية × 100. اليوم الجاري مستبعد؛ ليست نسبة حضور.', 'Biker washes ÷ completed wash days ÷ daily capacity × 100. Today is excluded; this is not attendance.')}</p>
      {capacity?.unlinked > 0 && <p role="status">{text('غسلات بلا ربط بايكر مؤكّد', 'Washes without a confirmed biker link')}: {num(capacity.unlinked)}</p>}
      {!capacity?.rows.length ? <p>{text('لا توجد غسلات مرتبطة ببايكر في الشهر المختار.', 'No biker-linked washes in the selected month.')}</p>
        : <div className="sw-overview-detail__table"><table><thead><tr>
          {[text('البايكر', 'Biker'), text('الغسلات', 'Washes'), text('أيام الغسيل', 'Wash days'), text('المتوسط اليومي', 'Daily average'), text('نسبة الإنتاج', 'Output percentage')].map(label => <th key={label} scope="col">{label}</th>)}
        </tr></thead><tbody>{capacity.rows.map(row => <tr key={row.id}><th scope="row"><bdi>{row.biker?.driverExternalId || '—'}</bdi> · <span translate="no">{name(row.biker)}</span></th>
          <td>{num(row.washes)}</td><td>{num(row.washDays)}</td><td>{num(row.average)}</td><td>{row.percentage === null ? text('لا أيام مكتملة', 'No completed days') : `${num(row.percentage)}%`}</td></tr>)}</tbody></table></div>}
    </> : <>
      {updated && <p>{text('آخر قراءة للبقشيش', 'Tips last read')}: <bdi>{updated}</bdi> {text('(الرياض)', '(Riyadh)')}</p>}
      {tips === null ? <p role="status">{text('تفاصيل البايكرز غير متاحة في لقطة البقشيش الحالية؛ المحفوظ إجمالي فقط. تظهر الأسماء بعد وصول تفاصيل موثقة من سويتر.', 'Biker details are unavailable in the current tips snapshot; only the total is stored. Names appear after verified details arrive from Sweater.')}</p>
        : !tips.length ? <p>{text('لا بقشيش في القراءة المفصلة لهذا الشهر.', 'No tips in this month’s detailed reading.')}</p>
          : <ul>{tips.map(row => { const matches = bikers.filter(biker => String(biker.driverExternalId || '').trim() === row.driverExternalId);
            return <li key={row.driverExternalId}><span><bdi>{row.driverExternalId}</bdi> · <span translate="no">{name(matches.length === 1 ? matches[0] : null)}</span></span><bdi>{formatCurrencyPrecise(row.netAmount)}</bdi></li>; })}</ul>}
    </>}
  </section></ModalSurface>;
}
