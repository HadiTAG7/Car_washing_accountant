import { useMemo, useState } from 'react';
import { CalendarClock, CheckCircle2, Wallet, X } from 'lucide-react';
import { StatCard } from './UI';
import ModalSurface from './ModalSurface';
import { formatCurrency, formatNumber } from '../data/initialData';
import { formatDateOnly } from '../lib/dateOnly';
import { getLocale } from '../i18n/locale';
import { washDailySummary } from '../lib/washDailySummary';
import './WashActivityCards.css';

export default function WashActivityCards({ items, scalingFactor = 1, loading = false, error = null }) {
  const [detail, setDetail] = useState(null);
  const summary = useMemo(() => washDailySummary(items, scalingFactor), [items, scalingFactor]);
  // A failed/loading source must not present its cached detail as a current result.
  const available = !loading && !error;
  const dateLabel = date => date ? formatDateOnly(date, getLocale()) : 'تاريخ غير متاح';
  return <>
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-5">
      <StatCard className="col-span-2 md:col-span-1" icon={CheckCircle2} tone="emerald"
        label="إجمالي الغسلات المكتملة" value={available ? formatNumber(summary.completed) : '—'}
        sub={items.length ? `${formatNumber(items.length)} ${items.length === 1 ? 'دفعة' : 'دفعات'} مسجّلة` : 'ابدأ بتسجيل أول دفعة'} />
      <button type="button" className="sw-wash-card-trigger" disabled={!available}
        aria-label="عرض الإيرادات اليومية" aria-haspopup="dialog" onClick={() => setDetail('revenue')}>
        <StatCard icon={Wallet} tone="primary" label="إجمالي الإيرادات"
          value={available ? formatCurrency(summary.revenue) : '—'} sub="اضغط لعرض الإيرادات يومًا بيوم" />
      </button>
      <button type="button" className="sw-wash-card-trigger" disabled={!available}
        aria-label="عرض الغسلات اليومية" aria-haspopup="dialog" onClick={() => setDetail('washes')}>
        <StatCard icon={CalendarClock} tone="amber" label="آخر يوم مسجّل"
          value={available && summary.latest ? formatNumber(summary.latest.quantity) : '—'}
          sub={summary.latest ? dateLabel(summary.latest.date) : 'لا توجد غسلات مكتملة مؤرخة'} />
      </button>
    </div>
    {detail && available && <ModalSurface className="sw-wash-daily" onClose={() => setDetail(null)}>
      <header className="sw-wash-daily__header">
        <h2>{detail === 'revenue' ? 'الإيرادات اليومية' : 'الغسلات اليومية'}</h2>
        <button type="button" className="sw-tap sw-wash-daily__close" aria-label="إغلاق التفاصيل" onClick={() => setDetail(null)}><X size={20} /></button>
      </header>
      <div className="sw-wash-daily__body">
        <p>الغسلات المكتملة من السجل المحمّل فقط؛ الأيام غير الموجودة لا تعني صفر غسلات.</p>
        {detail === 'revenue' && <p>عدد الغسلات × سعر الغسلة؛ ليست إثباتًا للتحصيل أو بديلًا عن قائمة الدخل.</p>}
        {scalingFactor !== 1 && <p>القيم المعروضة حسب الحصّة الحالية؛ عدد الغسلات مقرّب لكل يوم.</p>}
        {summary.days.length ? <table>
          <thead><tr><th>التاريخ</th><th>{detail === 'revenue' ? 'إجمالي الإيرادات' : 'عدد الغسلات'}</th></tr></thead>
          <tbody>{summary.days.map(day => <tr key={day.date || 'undated'}>
            <td>{dateLabel(day.date)}</td><td className="tabular-nums">{detail === 'revenue' ? formatCurrency(day.revenue) : formatNumber(day.quantity)}</td>
          </tr>)}</tbody>
          <tfoot><tr><th>الإجمالي</th><td className="tabular-nums">{detail === 'revenue' ? formatCurrency(summary.revenue) : formatNumber(summary.completed)}</td></tr></tfoot>
        </table> : <p>لا توجد غسلات مكتملة في السجل المحمّل.</p>}
      </div>
    </ModalSurface>}
  </>;
}
