import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, ChevronLeft, Calendar as CalendarIcon } from 'lucide-react';

/**
 * Date field with a branded calendar — replaces `<input type="date">`.
 *
 * Why not the native control: its popup is drawn by the browser and cannot
 * be styled at all (only the trigger icon is reachable, via
 * ::-webkit-calendar-picker-indicator). On an Arabic RTL page it also
 * renders Arabic-Indic digits (٢٠٢٦/٠٨/١١), which clash with the Latin
 * figures used everywhere else in this app's money and date columns.
 *
 * This component owns both: every digit is emitted with an explicit
 * `latn` numbering system, and the calendar is built from the design
 * system's tokens.
 *
 * Value contract is unchanged from the native input — an ISO `YYYY-MM-DD`
 * string (or '') in, and an event-shaped `{ target: { name, value } }` out,
 * so existing `handleChange` handlers keep working untouched.
 */

// Short forms chosen deliberately — slicing the full names yields awkward
// stumps, and the 7-column grid has no room for them anyway.
const WEEKDAYS = ['أحد', 'اثن', 'ثلا', 'أرب', 'خمس', 'جمع', 'سبت'];
const MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

// Local-zone today as YYYY-MM-DD — never `toISOString()`, which shifts a
// late-evening date back a day in +03:00.
function todayIso() {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}
const pad = (n) => String(n).padStart(2, '0');
const isoOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

function parseIso(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2] - 1, d = +m[3];
  const dt = new Date(y, mo, d);
  // Reject impossible dates like 2026-02-31, which Date silently rolls over.
  if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) return null;
  return { y, mo, d };
}

/** "11 أغسطس 2026" — Arabic month name, Latin digits. */
function displayOf(value) {
  const p = parseIso(value);
  if (!p) return '';
  return `${p.d} ${MONTHS[p.mo]} ${p.y}`;
}

export default function DateField({
  id, name, value, onChange, required = false, disabled = false,
  className = '', ariaLabel,
}) {
  const [open, setOpen]   = useState(false);
  const parsed            = parseIso(value);
  const today             = parseIso(todayIso());
  // The month the grid is showing; follows the value, else today.
  const [viewY, setViewY] = useState(parsed?.y  ?? today.y);
  const [viewM, setViewM] = useState(parsed?.mo ?? today.mo);
  const wrapRef  = useRef(null);
  const popupRef = useRef(null);
  // How the panel is presented. An anchored popover is absolutely positioned,
  // which the modal's `overflow-y-auto` clips once the panel is taller than
  // the space left below the field — on a phone that hid the last week row
  // and both footer actions. Below `sm` the panel is therefore a CENTRED
  // SHEET: `position: fixed` is not clipped by an overflow ancestor (none of
  // these modals establish a containing block), so it can never be cut off.
  const [asSheet, setAsSheet] = useState(false);
  const [openUp, setOpenUp]   = useState(false);

  // Re-centre the grid whenever the field's value changes underneath us
  // (e.g. the parent seeds today's date when a modal opens). This is the
  // "adjust state during render" pattern the codebase already uses for
  // FormattedAmountInput — an effect would paint the stale month first and
  // then flash to the right one, and trips the cascading-render lint rule.
  const [seenValue, setSeenValue] = useState(value);
  if (value !== seenValue) {
    setSeenValue(value);
    const p = parseIso(value);
    if (p) { setViewY(p.y); setViewM(p.mo); }
  }

  // Dismiss on outside click / Escape.
  useEffect(() => {
    if (!open) return undefined;
    function onDocDown(e) {
      const inWrap  = wrapRef.current?.contains(e.target);
      const inPanel = popupRef.current?.contains(e.target);
      if (!inWrap && !inPanel) setOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Measured once per open: the panel is ~370px tall, so if the trigger sits
  // closer than that to the viewport bottom (and has more room above), open
  // upward instead of into clipped space.
  const PANEL_H = 405;
  function toggleOpen() {
    if (disabled) return;
    if (!open) {
      const sheet = window.innerWidth < 640;
      setAsSheet(sheet);
      if (!sheet && wrapRef.current) {
        const r = wrapRef.current.getBoundingClientRect();
        const below = window.innerHeight - r.bottom;
        setOpenUp(below < PANEL_H && r.top > below);
      }
    }
    setOpen((v) => !v);
  }

  function emit(next) {
    onChange?.({ target: { name, value: next, type: 'text' } });
  }
  function pick(day) {
    emit(isoOf(viewY, viewM, day));
    setOpen(false);
  }
  function shiftMonth(delta) {
    const m = viewM + delta;
    if (m < 0)       { setViewM(11); setViewY(viewY - 1); }
    else if (m > 11) { setViewM(0);  setViewY(viewY + 1); }
    else             { setViewM(m); }
  }

  // Grid cells: leading blanks for the weekday offset, then the days.
  const cells = useMemo(() => {
    const firstDow  = new Date(viewY, viewM, 1).getDay();      // 0 = Sunday
    const daysInMon = new Date(viewY, viewM + 1, 0).getDate();
    return [
      ...Array.from({ length: firstDow }, () => null),
      ...Array.from({ length: daysInMon }, (_, i) => i + 1),
    ];
  }, [viewY, viewM]);

  const isSelectedMonth = parsed && parsed.y === viewY && parsed.mo === viewM;
  const isTodayMonth    = today.y === viewY && today.mo === viewM;

  return (
    <div ref={wrapRef} className="relative">
      {/* Trigger. A button, not an input: the value is always chosen from
          the calendar, so there is no partially-typed state to validate. */}
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={toggleOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel || 'اختيار التاريخ'}
        className={className || 'w-full px-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm text-right flex items-center justify-between gap-2 hover:border-slate-300 dark:hover:border-slate-600 focus:outline-none focus:border-primary-500 transition-colors disabled:opacity-60 disabled:cursor-not-allowed'}
      >
        <span className={value ? 'tabular-nums' : 'text-slate-400 dark:text-slate-500'}>
          {value ? displayOf(value) : 'اختر التاريخ'}
        </span>
        <CalendarIcon size={16} className="shrink-0 text-slate-400 dark:text-slate-500" />
      </button>

      {/* Mirrors the value for native form validation, since the trigger is
          a button and carries no value of its own. */}
      {required && (
        <input
          type="text"
          tabIndex={-1}
          aria-hidden="true"
          required
          value={value || ''}
          onChange={() => {}}
          className="sr-only absolute opacity-0 pointer-events-none h-0 w-0"
        />
      )}

      {/* Sheet backdrop — phones only. Sits above the host modal's z-50. */}
      {open && asSheet && (
        <div
          className="fixed inset-0 z-[60] bg-slate-950/60"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {open && (
        <div
          ref={popupRef}
          role="dialog"
          aria-modal={asSheet ? 'true' : undefined}
          aria-label="التقويم"
          className={
            asSheet
              ? 'fixed z-[61] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[19rem] max-w-[calc(100vw-2rem)] bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-700 rounded-card p-3'
              : `absolute z-50 right-0 w-[19rem] max-w-[calc(100vw-2rem)] bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-700 rounded-card p-3 ${
                openUp ? 'bottom-full mb-2' : 'top-full mt-2'
              }`
          }
          style={{ boxShadow: 'var(--sw-shadow-overlay)' }}
        >
          {/* Month navigation. In RTL the "previous" affordance points
              right, matching the reading direction. */}
          <div className="flex items-center justify-between gap-2 mb-3">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              aria-label="الشهر السابق"
              className="sw-tap w-9 h-9 inline-flex items-center justify-center rounded-control text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
            >
              <ChevronRight size={18} />
            </button>
            <div className="text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              {MONTHS[viewM]} {viewY}
            </div>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              aria-label="الشهر التالي"
              className="sw-tap w-9 h-9 inline-flex items-center justify-center rounded-control text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
            >
              <ChevronLeft size={18} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAYS.map((w) => (
              <div key={w} className="h-7 flex items-center justify-center text-[10px] font-bold text-slate-500 dark:text-slate-400">
                {w}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, i) => {
              if (day === null) return <div key={`blank-${i}`} className="h-9" />;
              const selected = isSelectedMonth && parsed.d === day;
              const isToday  = isTodayMonth && today.d === day && !selected;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => pick(day)}
                  aria-current={selected ? 'date' : undefined}
                  className={`h-9 rounded-control text-[13px] font-semibold tabular-nums transition-colors ${
                    selected
                      ? 'bg-primary-700 text-white'
                      : isToday
                        ? 'bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => { emit(''); setOpen(false); }}
              className="text-[12px] font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 px-2 py-1.5 rounded-control transition-colors"
            >
              مسح
            </button>
            <button
              type="button"
              onClick={() => { emit(todayIso()); setOpen(false); }}
              className="text-[12px] font-bold text-primary-700 dark:text-primary-300 hover:underline px-2 py-1.5 rounded-control transition-colors"
            >
              اليوم
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
