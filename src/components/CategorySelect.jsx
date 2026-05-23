import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * CategorySelect — accessible custom dropdown used in the Add Expense
 * modals. Replaces the native <select>, which on some browsers (notably
 * mobile Safari and dark-mode desktop dropdowns) opens with a tall padded
 * panel and a noticeable gap at the top.
 *
 * The panel is content-sized: the first option sits flush against the
 * top edge, the last option flush against the bottom. A thin custom
 * scrollbar kicks in only when categories exceed the max-height cap.
 */
export default function CategorySelect({
  categories = [],
  value,
  onChange,
  placeholder = 'اختر التصنيف',
  emptyLabel  = '— لا توجد تصنيفات —',
  ariaLabel,
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  // Filter out any null / undefined / blank-label rows so the list never
  // renders an empty slot at the top (or anywhere). Trim defensively.
  const safeCategories = categories.filter(
    (c) => c && typeof c.label === 'string' && c.label.trim().length > 0,
  );
  const empty = safeCategories.length === 0;
  const selected = safeCategories.find((c) => c.id === value);
  const displayLabel = empty
    ? emptyLabel
    : (selected?.label || placeholder);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function handleKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative flex-1">
      <button
        type="button"
        onClick={() => !empty && setOpen((o) => !o)}
        disabled={empty}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <span className="flex-1 text-right truncate">{displayLabel}</span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-slate-400 dark:text-slate-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && !empty && (
        <ul
          role="listbox"
          // No vertical padding on the panel itself — items hug the top
          // and bottom edges so there's no awkward empty space above the
          // first option. The wrapper's rounded-xl + overflow-hidden
          // clips the first/last items' corners cleanly.
          className="absolute top-full right-0 left-0 mt-1 z-30 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl overflow-hidden max-h-64 overflow-y-auto m-0 p-0 list-none"
        >
          {safeCategories.map((cat) => {
            const active = cat.id === value;
            return (
              <li key={cat.id} role="option" aria-selected={active} className="m-0 p-0">
                <button
                  type="button"
                  onClick={() => { onChange(cat.id); setOpen(false); }}
                  className={`w-full block px-4 py-2.5 text-right text-sm transition-colors ${
                    active
                      ? 'bg-primary-50 dark:bg-primary-500/20 text-primary-800 dark:text-primary-200 font-semibold'
                      : 'text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60'
                  }`}
                >
                  {cat.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
