import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Trash2 } from 'lucide-react';

// Normalize a label for protected-label comparison (lowercase + collapse
// whitespace). Cheap, intentionally light — we only compare against the
// short hard-coded defaults list, not arbitrary user content.
function normalizeLabel(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * CategorySelect — accessible custom dropdown used in the Add Expense
 * modals. Replaces the native <select>, which on some browsers (notably
 * mobile Safari and dark-mode desktop dropdowns) opens with a tall padded
 * panel and a noticeable gap at the top.
 *
 * The panel is content-sized: the first option sits flush against the
 * top edge, the last option flush against the bottom. A thin custom
 * scrollbar kicks in only when categories exceed the max-height cap.
 *
 * Props:
 *   onDelete         (id) => Promise — when provided, every non-protected
 *                    option grows a hover trash icon that calls this
 *                    handler after a confirmation prompt.
 *   protectedLabels  string[] — exact labels that can never be deleted
 *                    (system defaults). Compared case-insensitively after
 *                    whitespace collapse.
 *   isOptionProtected (cat) => boolean — optional extra predicate; the
 *                    option is treated as protected if either this returns
 *                    true OR its label is in `protectedLabels`. Use it
 *                    to lock down dynamic / special categories.
 */
export default function CategorySelect({
  categories = [],
  value,
  onChange,
  placeholder = 'اختر التصنيف',
  emptyLabel  = '— لا توجد تصنيفات —',
  ariaLabel,
  onDelete,
  protectedLabels = [],
  isOptionProtected,
}) {
  const [open, setOpen] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
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

  const protectedSet = useMemo(
    () => new Set((protectedLabels || []).map(normalizeLabel)),
    [protectedLabels],
  );
  function isProtected(cat) {
    if (typeof isOptionProtected === 'function' && isOptionProtected(cat)) return true;
    return protectedSet.has(normalizeLabel(cat.label));
  }

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

  async function handleDeleteClick(e, cat) {
    // Trash control is inside the option <button>; without these two
    // calls the click bubbles, selects the category, and closes the
    // dropdown before the confirmation prompt appears.
    e.preventDefault();
    e.stopPropagation();
    if (!onDelete || deletingId) return;
    const ok = typeof window !== 'undefined'
      ? window.confirm('هل أنت متأكد من حذف هذا التصنيف نهائياً من القوائم؟')
      : true;
    if (!ok) return;
    setDeletingId(cat.id);
    try {
      await onDelete(cat.id);
    } catch (err) {
      console.error('CategorySelect delete failed:', err);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div ref={containerRef} className="relative flex-1">
      <button
        type="button"
        onClick={() => !empty && setOpen((o) => !o)}
        disabled={empty}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm font-medium focus:outline-none focus:border-primary-500 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <span className="flex-1 text-right truncate">{displayLabel}</span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-slate-500 dark:text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && !empty && (
        <ul
          role="listbox"
          className="absolute top-full right-0 left-0 mt-1 z-30 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-control overflow-hidden max-h-64 overflow-y-auto m-0 p-0 list-none"
          style={{ boxShadow: 'var(--sw-shadow-overlay)' }}
        >
          {safeCategories.map((cat) => {
            const active     = cat.id === value;
            const locked     = isProtected(cat);
            const isDeleting = deletingId === cat.id;
            const canDelete  = Boolean(onDelete) && !locked;
            return (
              <li key={cat.id} role="option" aria-selected={active} className="m-0 p-0">
                <button
                  type="button"
                  onClick={() => { onChange(cat.id); setOpen(false); }}
                  className={`group relative w-full block px-4 py-2.5 text-right text-sm transition-colors ${
                    active
                      ? 'bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 font-semibold'
                      : 'text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                  } ${canDelete ? 'pl-10' : ''}`}
                >
                  {cat.label}
                  {canDelete && (
                    <span
                      role="button"
                      tabIndex={-1}
                      onClick={(e) => handleDeleteClick(e, cat)}
                      onMouseDown={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') handleDeleteClick(e, cat);
                      }}
                      title="حذف هذا التصنيف"
                      aria-label={`حذف التصنيف ${cat.label}`}
                      className={`sw-tap absolute left-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-7 h-7 rounded-control text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/15 hover:scale-110 transition-transform duration-150 ${
                        isDeleting
                          ? 'opacity-100 cursor-wait'
                          : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
                      }`}
                    >
                      <Trash2 size={14} strokeWidth={2.2} />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
