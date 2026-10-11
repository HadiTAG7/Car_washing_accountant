import { Card, SectionHeader } from './UI';
import { formatCurrency, formatNumber } from '../data/initialData';
import { summarizeOwnerWashes } from '../lib/sweater/washSummary';
import { displayRecordedBikerName, recordedBikerSweaterId } from '../lib/bikerNames';
import { sortBikers } from '../lib/bikerSort';
import { useLanguage } from '../i18n/useLanguage';
import { useState } from 'react';
import { useSweaterWashDetails } from '../hooks/useSweaterWashDetails';
import { normalizeBookingStatus } from '../../functions/src/sweater/vocab';
import { BOOKING_STATUS_AR } from '../lib/sweater/labels';
import { ownerWashTaxSplit } from '../lib/sweater/ownerWashTax';

export default function SweaterWashWorkerSummary({ washes, bikers = [], scalingFactor = 1, detailsSource }) {
  const { language } = useLanguage();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const groups = sortBikers(summarizeOwnerWashes(washes).map(group => ({ ...group,
    displayName: displayRecordedBikerName(group, bikers, language),
    driverExternalId: recordedBikerSweaterId(group, bikers) })), { column: 'sweaterId', direction: 'asc' });
  const ownDetails = useSweaterWashDetails(groups.flatMap(group => group.washes.map(wash => wash.sspBookingId)), detailsOpen && !detailsSource);
  const { bookings, loading, error } = detailsSource || ownDetails;
  const byBookingId = new Map(bookings.map(booking => [booking.sspBookingId, booking.record]));
  const statusLabel = rawStatus => {
    if (!rawStatus) return '—';
    const code = normalizeBookingStatus(rawStatus);
    return language === 'ar' && code !== 'unknown' ? BOOKING_STATUS_AR[code] || rawStatus : rawStatus;
  };
  if (!groups.length) return null;
  return <Card className="p-4 sm:p-5 space-y-3">
    <SectionHeader title="غسلات سويتر حسب العامل" subtitle={language === 'en'
      ? 'Completed washes; commission entitlement is independent of collection'
      : 'غسلات منفذة؛ استحقاق العمولة مستقل عن التحصيل'} />
    <div className="sm:hidden space-y-3">{groups.map(group => <div key={group.bikerId || group.bikerName} className="border-b border-slate-100 dark:border-slate-800 pb-3 last:border-0">
      <p className="text-xs text-slate-500 mb-2">Sweater ID: <span translate="no" dir="ltr" className="inline-block tabular-nums">{group.driverExternalId || '—'}</span></p>
      <p className="font-semibold text-sm mb-2">{group.displayName}</p>
      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div><dt className="text-slate-500">الغسلات</dt><dd className="mt-1 tabular-nums">{formatNumber(Math.round(group.quantity * scalingFactor))}</dd></div>
        <div><dt className="text-slate-500">{language === 'en' ? 'Recorded service value' : 'قيمة الخدمة المسجلة'}</dt><dd className="mt-1 tabular-nums">{formatCurrency(group.totalAmount * scalingFactor)}</dd></div>
        <div><dt className="text-slate-500">العمولة</dt><dd className="mt-1 tabular-nums">{formatCurrency(group.commission * scalingFactor)}</dd></div>
      </dl>
    </div>)}</div>
    <div className="hidden sm:block overflow-x-auto"><table className="w-full text-sm [&_th]:px-2 [&_td]:px-2 [&_td]:py-2 [&_th]:text-start [&_td]:text-start" aria-label="ملخص غسلات سويتر حسب العامل">
      <thead><tr><th>Sweater ID</th><th>العامل</th><th>الغسلات</th><th>{language === 'en' ? 'Recorded service value' : 'قيمة الخدمة المسجلة'}</th><th>عمولة مستحقة مع الراتب</th></tr></thead>
      <tbody>{groups.map(group => <tr key={group.bikerId || group.bikerName}>
        <td dir="ltr" translate="no" className="whitespace-nowrap tabular-nums">{group.driverExternalId || '—'}</td><td className="py-2">{group.displayName}</td><td>{formatNumber(Math.round(group.quantity * scalingFactor))}</td>
        <td className="whitespace-nowrap tabular-nums">{formatCurrency(group.totalAmount * scalingFactor)}</td><td className="whitespace-nowrap tabular-nums">{formatCurrency(group.commission * scalingFactor)}</td>
      </tr>)}</tbody>
    </table></div>
    <p className="text-xs text-slate-500">{language === 'en'
      ? 'Commission is an entitlement, not a payment. Review payroll before approval; these figures do not prove collection.'
      : 'العمولة استحقاق وليست صرفًا؛ راجع المسير قبل اعتماده. هذه الأرقام لا تثبت التحصيل.'}</p>
    <details className="text-sm" onToggle={event => setDetailsOpen(event.currentTarget.open)}><summary className="cursor-pointer">تفاصيل الحجوزات</summary>
      {loading && <p role="status" className="mt-2">نحمّل تفاصيل الحجوزات...</p>}
      {error && <p role="alert" className="mt-2 text-red-700 dark:text-red-300">تعذّر تحميل حالة الحجز من المصدر المحفوظ.</p>}
      <div className="overflow-x-auto mt-2"><table className="w-full min-w-[640px] text-sm [&_th]:px-3 [&_td]:px-3 [&_th]:text-start [&_td]:text-start" aria-label="تفاصيل غسلات سويتر">
        <thead><tr><th>Sweater ID</th><th>العامل</th><th>{language === 'en' ? 'Booking ID' : 'رقم الحجز'}</th><th>التاريخ</th><th>{language === 'en' ? 'Gross' : 'قيمة الغسلة شاملة الضريبة'}</th><th>الحالة</th></tr></thead>
        <tbody>{groups.flatMap(group => group.washes.map(wash => {
          const tax = ownerWashTaxSplit(wash);
          return <tr key={wash.sspBookingId}>
            <td dir="ltr" translate="no" className="whitespace-nowrap tabular-nums">{group.driverExternalId || '—'}</td><td className="py-2">{group.displayName}</td><td dir="ltr">{wash.sspBookingId}</td>
            <td dir="ltr">{byBookingId.get(wash.sspBookingId)?.serviceDate || wash.washDate || '—'}</td>
            <td className="whitespace-nowrap tabular-nums">{tax ? formatCurrency(tax.gross) : '—'}</td>
            <td>{statusLabel(byBookingId.get(wash.sspBookingId)?.rawStatus || wash.rawStatus)}</td>
          </tr>;
        }))}</tbody>
      </table></div>
    </details>
  </Card>;
}
