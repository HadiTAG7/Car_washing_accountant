import { Search, Bell, Calendar } from 'lucide-react';

/**
 * Top bar with page title, search, notifications, and date.
 *
 * Props:
 *   title        page title (string)
 *   subtitle     small grey line below title
 *   actions      optional ReactNode (e.g. button) rendered next to search
 */
export default function TopBar({ title, subtitle, actions }) {
  const today = new Date();
  const formatted = new Intl.DateTimeFormat('ar-SA', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(today);

  return (
    <header className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-slate-200">
      <div className="px-8 py-4 flex items-center justify-between gap-6">
        {/* Title */}
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">{title}</h1>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>

        {/* Right cluster: search + actions + icons + date */}
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative hidden md:block">
            <Search
              size={16}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
            />
            <input
              type="search"
              placeholder="بحث..."
              className="w-64 pr-9 pl-3 py-2 rounded-xl bg-slate-100 border border-transparent focus:bg-white focus:border-primary-300 focus:ring-2 focus:ring-primary-100 focus:outline-none text-sm placeholder:text-slate-400 transition-all"
            />
          </div>

          {actions}

          {/* Notifications */}
          <button
            type="button"
            aria-label="الإشعارات"
            className="relative w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 transition-colors"
          >
            <Bell size={18} />
            <span className="absolute top-1.5 left-1.5 w-2 h-2 rounded-full bg-red-500 ring-2 ring-white" />
          </button>

          {/* Date */}
          <div className="hidden lg:flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-100 text-slate-600">
            <Calendar size={16} />
            <span className="text-xs font-medium whitespace-nowrap">{formatted}</span>
          </div>

          {/* Avatar */}
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-primary-800 flex items-center justify-center text-white font-bold text-sm shadow-md">
            أ.ر
          </div>
        </div>
      </div>
    </header>
  );
}
