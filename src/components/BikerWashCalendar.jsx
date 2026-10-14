import { formatNumber } from '../data/initialData';

// Display the existing daily totals without changing attribution or counting.
export default function BikerWashCalendar({ periodKey, today, daily = [], available, language }) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey || '')) return null;
  const english = language === 'en';
  const text = (ar, en) => english ? en : ar;
  const first = new Date(`${periodKey}-01T00:00:00Z`);
  const nextMonth = new Date(first);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const daysInMonth = new Date(nextMonth.getTime() - 86400000).getUTCDate();
  const offset = first.getUTCDay();
  const counts = new Map(daily.map(day => [day.date, day.count]));
  const weekdays = english
    ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    : ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const monthTitle = new Intl.DateTimeFormat(english ? 'en-GB' : 'ar-SA-u-ca-gregory',
    { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first);
  const weeks = Array.from({ length: Math.ceil((offset + daysInMonth) / 7) }, (_, week) =>
    Array.from({ length: 7 }, (_, weekday) => {
      const day = week * 7 + weekday - offset + 1;
      return day >= 1 && day <= daysInMonth ? day : null;
    }));
  return <div className="sw-biker-calendar-wrap" dir={english ? 'ltr' : 'rtl'}>
    <table className="sw-biker-calendar" aria-label={text('تقويم الغسلات اليومية', 'Daily wash calendar')}>
      <caption>{monthTitle}</caption>
      <thead><tr>{weekdays.map(day => <th key={day} scope="col" title={day}>
        {english ? <abbr title={day}>{day.slice(0, 3)}</abbr> : day}
      </th>)}</tr></thead>
      <tbody>{weeks.map((week, index) => <tr key={index}>{week.map((day, column) => {
        if (day === null) return <td key={column} className="sw-biker-calendar__empty" aria-hidden="true" />;
        const date = `${periodKey}-${String(day).padStart(2, '0')}`;
        const state = !available ? 'unavailable' : date > today ? 'future' : !counts.has(date) ? 'outside' : 'recorded';
        const count = state === 'recorded' ? counts.get(date) : null;
        const description = state === 'recorded' ? `${formatNumber(count)} ${text('غسلات مسجلة', 'recorded washes')}`
          : state === 'future' ? text('يوم قادم', 'Future day')
            : state === 'outside' ? text('خارج فترة العامل', 'Outside worker period') : text('غير متاح', 'Unavailable');
        const isToday = date === today;
        return <td key={column} data-date={date} data-state={state} title={`${date}: ${description}`}>
          <div className={`sw-biker-calendar__day${isToday ? ' sw-biker-calendar__day--today' : ''}`}>
            <time dateTime={date} aria-current={isToday ? 'date' : undefined}>{formatNumber(day)}</time>
            <strong aria-label={`${date}: ${description}`}>{count === null ? '—' : formatNumber(count)}</strong>
            {isToday && <small>{text('اليوم', 'Today')}</small>}
          </div>
        </td>;
      })}</tr>)}</tbody>
    </table>
    <p className="sw-biker-profile__note">{text('الرقم داخل اليوم = عدد الغسلات المسجلة. — يوم قادم أو خارج فترة العامل أو بيانات غير متاحة.', 'Number inside each day = recorded washes. — means a future day, outside the worker period, or unavailable data.')}</p>
  </div>;
}
