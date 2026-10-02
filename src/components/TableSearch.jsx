import { formatNumber } from '../data/initialData';

export default function TableSearch({ id, label, value, onChange, shown, total, hint }) {
  return <div className="mb-4 min-w-0 space-y-2">
    <label htmlFor={id} className="block text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</label>
    <input id={id} type="search" value={value} onChange={(event) => onChange(event.target.value)}
      className="w-full min-w-0 rounded-control border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
      aria-describedby={`${id}-results`} />
    <p id={`${id}-results`} role="status" className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
      يعرض {formatNumber(shown)} من {formatNumber(total)} · {hint}
    </p>
  </div>;
}
