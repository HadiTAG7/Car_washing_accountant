import ModalSurface from './ModalSurface';
import { useEffect } from 'react';
import { X, Receipt, Activity, CalendarClock, Repeat } from 'lucide-react';
import { formatCurrency, formatNumber, formatDate } from '../data/initialData';
import { EmptyState } from './UI';

const HEADER_META = {
  revenue:  { title: 'الإيرادات التشغيلية',                icon: Receipt,        accent: 'text-emerald-700 dark:text-emerald-300', accentBg: 'bg-emerald-50 dark:bg-emerald-500/15' },
  variable: { title: 'التكاليف المتغيرة والعمولات',         icon: Activity,       accent: 'text-rose-700 dark:text-rose-300',       accentBg: 'bg-rose-50 dark:bg-rose-500/15' },
  monthly:  { title: 'المصاريف التشغيلية الشهرية الثابتة',  icon: CalendarClock,  accent: 'text-amber-700 dark:text-amber-300',     accentBg: 'bg-amber-50 dark:bg-amber-500/15' },
  annual:   { title: 'مخصص المصاريف السنوية الموزعة',      icon: Repeat,         accent: 'text-primary-700 dark:text-primary-300', accentBg: 'bg-primary-50 dark:bg-primary-500/15' },
};

function PaymentStatusPill({ status }) {
  const paid = status === 'paid';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-semibold ${
      paid
        ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-500/30'
        : 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-100 dark:border-amber-500/30'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${paid ? 'bg-emerald-600' : 'bg-amber-500'}`} />
      {paid ? 'مدفوع' : 'قيد الانتظار'}
    </span>
  );
}

// ─── Per-category tables ─────────────────────────────────────────────────
function RevenueTable({ rows }) {
  if (!rows.length) return <EmptyState icon={Receipt} title="لا توجد غسلات مكتملة في هذا الشهر" />;
  const total = rows.reduce((s, r) => s + r.total, 0);
  return (
    <table className="w-full min-w-[640px] text-sm">
      <thead>
        <tr className="text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
          <th className="py-3 px-4 whitespace-nowrap">التاريخ</th>
          <th className="py-3 px-4 whitespace-nowrap">اسم البايكر</th>
          <th className="py-3 px-4 whitespace-nowrap text-center tabular-nums">عدد الغسلات</th>
          <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">السعر</th>
          <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">الإجمالي</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-b border-slate-50 dark:border-slate-800/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
            <td className="py-3 px-4 whitespace-nowrap text-slate-700 dark:text-slate-300 tabular-nums">{formatDate(r.date)}</td>
            <td className="py-3 px-4 whitespace-normal break-words font-medium text-slate-900 dark:text-slate-100">{r.biker || '—'}</td>
            <td className="py-3 px-4 whitespace-nowrap text-center text-slate-700 dark:text-slate-300 tabular-nums">{formatNumber(r.quantity)}</td>
            <td className="py-3 px-4 whitespace-nowrap text-left text-slate-700 dark:text-slate-300 tabular-nums">{formatCurrency(r.price)}</td>
            <td className="py-3 px-4 whitespace-nowrap text-left font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">{formatCurrency(r.total)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t-2 border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800">
          <td colSpan={4} className="py-3 px-4 text-right font-bold text-slate-900 dark:text-slate-100">إجمالي الإيرادات</td>
          <td className="py-3 px-4 text-left font-extrabold text-slate-900 dark:text-slate-100 tabular-nums">{formatCurrency(total)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

function VariableTable({ rows }) {
  if (!rows.length) return <EmptyState icon={Activity} title="لا توجد تكاليف متغيرة لهذا الشهر" />;
  const total = rows.reduce((s, r) => s + r.total, 0);
  return (
    <table className="w-full min-w-[640px] text-sm">
      <thead>
        <tr className="text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
          <th className="py-3 px-4 whitespace-nowrap">المصروف / البايكر</th>
          <th className="py-3 px-4 whitespace-nowrap">التصنيف</th>
          <th className="py-3 px-4 whitespace-nowrap text-center tabular-nums">الكمية</th>
          <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">تكلفة الوحدة</th>
          <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">الإجمالي</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-b border-slate-50 dark:border-slate-800/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
            <td className="py-3 px-4 whitespace-normal break-words font-medium text-slate-900 dark:text-slate-100">
              <div className="flex items-center gap-1.5">
                <span>{r.name}</span>
                {r.isVirtual && (
                  <span className="inline-flex items-center gap-1 bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 border border-primary-100 dark:border-primary-500/30 text-[10px] font-bold px-1.5 py-0.5 rounded-control">
                    تلقائي
                  </span>
                )}
              </div>
            </td>
            <td className="py-3 px-4 whitespace-nowrap">
              <span className="inline-flex text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-1 rounded-control">{r.category}</span>
            </td>
            <td className="py-3 px-4 whitespace-nowrap text-center text-slate-700 dark:text-slate-300 tabular-nums">{formatNumber(r.quantity)}</td>
            <td className="py-3 px-4 whitespace-nowrap text-left text-slate-700 dark:text-slate-300 tabular-nums">{formatCurrency(r.unitCost)}</td>
            <td className="py-3 px-4 whitespace-nowrap text-left font-bold text-rose-700 dark:text-rose-400 tabular-nums">{formatCurrency(r.total)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t-2 border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800">
          <td colSpan={4} className="py-3 px-4 text-right font-bold text-slate-900 dark:text-slate-100">إجمالي التكاليف المتغيرة</td>
          <td className="py-3 px-4 text-left font-extrabold text-slate-900 dark:text-slate-100 tabular-nums">{formatCurrency(total)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

function MonthlyTable({ rows }) {
  if (!rows.length) return <EmptyState icon={CalendarClock} title="لا توجد مصاريف شهرية ثابتة لهذا الشهر" />;
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <table className="w-full min-w-[640px] text-sm">
      <thead>
        <tr className="text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
          <th className="py-3 px-4 whitespace-nowrap">البند</th>
          <th className="py-3 px-4 whitespace-nowrap">التصنيف</th>
          <th className="py-3 px-4 whitespace-nowrap">الحالة</th>
          <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">القيمة الشهرية</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-b border-slate-50 dark:border-slate-800/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
            <td className="py-3 px-4 whitespace-normal break-words font-medium text-slate-900 dark:text-slate-100">
              <div className="flex items-center gap-1.5">
                <span>{r.name}</span>
                {r.isOneTime && (
                  /* Informational (indigo), not brand: `accent-*` aliases the
                     brand ramp in the DS, so an orange chip here read as an
                     action and clashed with the "تلقائي" marker. */
                  <span className="inline-flex items-center gap-1 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-500/30 text-[10px] font-bold px-1.5 py-0.5 rounded-control">
                    مرة واحدة
                  </span>
                )}
              </div>
            </td>
            <td className="py-3 px-4 whitespace-nowrap">
              <span className="inline-flex text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-1 rounded-control">{r.category}</span>
            </td>
            <td className="py-3 px-4 whitespace-nowrap"><PaymentStatusPill status={r.status} /></td>
            <td className="py-3 px-4 whitespace-nowrap text-left font-bold text-rose-700 dark:text-rose-400 tabular-nums">{formatCurrency(r.amount)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t-2 border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800">
          <td colSpan={3} className="py-3 px-4 text-right font-bold text-slate-900 dark:text-slate-100">إجمالي المصاريف الشهرية</td>
          <td className="py-3 px-4 text-left font-extrabold text-slate-900 dark:text-slate-100 tabular-nums">{formatCurrency(total)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

function AnnualTable({ rows }) {
  if (!rows.length) return <EmptyState icon={Repeat} title="لا توجد مصاريف سنوية مسجلة" />;
  const fullTotal     = rows.reduce((s, r) => s + r.annual, 0);
  const allocatedSum  = rows.reduce((s, r) => s + r.monthly, 0);
  return (
    <table className="w-full min-w-[640px] text-sm">
      <thead>
        <tr className="text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
          <th className="py-3 px-4 whitespace-nowrap">البند</th>
          <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">الميزانية السنوية الكاملة</th>
          <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">القيمة الموزعة للشهر الحالي (÷ 12)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-b border-slate-50 dark:border-slate-800/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
            <td className="py-3 px-4 whitespace-normal break-words font-medium text-slate-900 dark:text-slate-100">{r.name}</td>
            <td className="py-3 px-4 whitespace-nowrap text-left text-slate-700 dark:text-slate-300 tabular-nums">{formatCurrency(r.annual)}</td>
            <td className="py-3 px-4 whitespace-nowrap text-left font-bold text-rose-700 dark:text-rose-400 tabular-nums">{formatCurrency(r.monthly)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t-2 border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800">
          <td className="py-3 px-4 text-right font-bold text-slate-900 dark:text-slate-100">الإجمالي</td>
          <td className="py-3 px-4 text-left font-extrabold text-slate-900 dark:text-slate-100 tabular-nums">{formatCurrency(fullTotal)}</td>
          <td className="py-3 px-4 text-left font-extrabold text-slate-900 dark:text-slate-100 tabular-nums">{formatCurrency(allocatedSum)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

// ─── Modal shell ─────────────────────────────────────────────────────────
export default function FinancialDetailsModal({ category, monthLabel, data, onClose }) {
  // Escape-to-close + lock background scroll while open.
  useEffect(() => {
    if (!category) return;
    function handleKey(e) {
      if (e.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', handleKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [category, onClose]);

  if (!category) return null;
  const meta = HEADER_META[category];
  if (!meta) return null;
  const HeaderIcon = meta.icon;
  const rows = data?.[category] ?? [];

  return (
    <ModalSurface onClose={onClose} className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`تفاصيل كشف: ${meta.title} - ${monthLabel}`}
        className="relative bg-white dark:bg-slate-900 rounded-card border border-slate-100 dark:border-slate-800 w-full max-w-4xl mx-4 my-4 max-h-[92vh] overflow-hidden flex flex-col"
        style={{ boxShadow: 'var(--sw-shadow-overlay)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800">
          <div className="flex items-center gap-3 min-w-0">
            <span className={`w-10 h-10 rounded-control flex items-center justify-center shrink-0 ${meta.accentBg} ${meta.accent}`}>
              <HeaderIcon size={20} strokeWidth={2.2} />
            </span>
            <div className="min-w-0">
              <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 truncate">
                تفاصيل كشف: {meta.title}
              </h3>
              <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 truncate">
                {monthLabel}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="sw-tap flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 p-1.5 rounded-control hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shrink-0"
            aria-label="إغلاق"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body — scrollable table area */}
        <div className="flex-1 overflow-y-auto">
          <div className="overflow-x-auto p-4 sm:p-6">
            {category === 'revenue'  && <RevenueTable  rows={rows} />}
            {category === 'variable' && <VariableTable rows={rows} />}
            {category === 'monthly'  && <MonthlyTable  rows={rows} />}
            {category === 'annual'   && <AnnualTable   rows={rows} />}
          </div>
        </div>
      </div>
    </ModalSurface>
  );
}
