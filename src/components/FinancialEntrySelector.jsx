import { X, Receipt } from 'lucide-react';

// The 'asset' (أصل رأسمالي) card was removed in the 2026-06 audit: since
// the assets module was cut, picking it closed the selector and opened
// nothing — a silent dead-end. Restore alongside a real assets modal if
// depreciation tracking ever returns.
const ENTRY_TYPES = [
  {
    id: 'item',
    icon: Receipt,
    // Both halves of the pair are required: a light-only `bg-amber-50`
    // glows white on the dark theme.
    iconBg: 'bg-amber-50 dark:bg-amber-500/15',
    iconColor: 'text-amber-700 dark:text-amber-300',
    title: 'دفعة لمرة واحدة',
    titleEn: 'One-time Cost',
    description: 'مصاريف تأسيسية غير قابلة للإهلاك تُدفع مرة واحدة فقط',
    examples: 'رسوم قانونية، تراخيص، هوية بصرية',
  },
];

export default function FinancialEntrySelector({ isOpen, onSelect, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={onClose} />

      <div
        className="relative bg-white dark:bg-slate-900 rounded-card border border-slate-100 dark:border-slate-800 w-full max-w-2xl mx-4 my-4 max-h-[92vh] overflow-y-auto"
        style={{ boxShadow: 'var(--sw-shadow-overlay)' }}
      >
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">إضافة سجل مالي</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">اختر نوع القيد المالي الذي تريد تسجيله</p>
          </div>
          <button
            onClick={onClose}
            className="sw-tap flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 p-1 rounded-control hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shrink-0"
            aria-label="إغلاق"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-5 sm:p-6 grid grid-cols-1 gap-4">
          {ENTRY_TYPES.map((type) => {
            const Icon = type.icon;
            return (
              <button
                key={type.id}
                type="button"
                onClick={() => onSelect(type.id)}
                className="flex items-start gap-4 p-5 border border-slate-100 dark:border-slate-800 rounded-smallcard bg-white dark:bg-slate-900 hover:border-primary-300 dark:hover:border-primary-500/40 hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-all text-right group"
              >
                <div className={`${type.iconBg} ${type.iconColor} w-12 h-12 rounded-control flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform`}>
                  <Icon size={22} strokeWidth={2.2} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="text-base font-bold text-slate-900 dark:text-slate-100">{type.title}</span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">{type.titleEn}</span>
                  </div>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-1.5">{type.description}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    مثال: {type.examples}
                  </p>
                </div>
                <div className="text-slate-300 dark:text-slate-600 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors mt-3">
                  ←
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
