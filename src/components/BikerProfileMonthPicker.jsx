import { useEffect, useId, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

export default function BikerProfileMonthPicker({ value, max, language, onChange }) {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(Number(value.slice(0, 4)));
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const panelId = useId();
  const english = language === 'en';
  const text = (ar, en) => english ? en : ar;
  const locale = english ? 'en-GB' : 'ar-SA-u-ca-gregory';
  const monthLabel = key => new Intl.DateTimeFormat(locale,
    { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${key}-01T00:00:00Z`));
  const close = () => { setOpen(false); triggerRef.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const dismiss = event => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  useEffect(() => {
    if (open) (panelRef.current?.querySelector('[aria-pressed="true"]:not(:disabled)')
      || panelRef.current?.querySelector('[data-month]:not(:disabled)'))?.focus();
  }, [open, viewYear]);
  return <div ref={rootRef} className="sw-profile-month-picker" dir={english ? 'ltr' : 'rtl'}
    onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={triggerRef} type="button" className="sw-profile-month-picker__trigger" aria-label={text('الشهر', 'Month')}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined}
      onClick={() => { setViewYear(Number(value.slice(0, 4))); setOpen(current => !current); }}>
      <CalendarDays size={19} aria-hidden="true" /><span>{monthLabel(value)}</span><ChevronDown size={16} aria-hidden="true" />
    </button>
    {open && <div ref={panelRef} id={panelId} role="dialog" aria-label={text('اختيار الشهر', 'Choose month')}
      className="sw-profile-month-picker__panel" onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      }}>
      <div className="sw-profile-month-picker__year">
        <button type="button" aria-label={text('السنة السابقة', 'Previous year')} disabled={viewYear <= 1}
          onClick={() => setViewYear(year => year - 1)}>{english ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}</button>
        <strong>{new Intl.NumberFormat(locale, { useGrouping: false }).format(viewYear)}</strong>
        <button type="button" aria-label={text('السنة التالية', 'Next year')} disabled={viewYear >= Number(max.slice(0, 4))}
          onClick={() => setViewYear(year => year + 1)}>{english ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}</button>
      </div>
      <div className="sw-profile-month-picker__months">{Array.from({ length: 12 }, (_, index) => {
        const key = `${String(viewYear).padStart(4, '0')}-${String(index + 1).padStart(2, '0')}`;
        const label = new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(new Date(`${key}-01T00:00:00Z`));
        return <button type="button" key={key} data-month={key} aria-label={`${label} ${viewYear}`}
          aria-pressed={value === key} disabled={key > max} onClick={() => { onChange(key); close(); }}>{label}</button>;
      })}</div>
    </div>}
  </div>;
}
