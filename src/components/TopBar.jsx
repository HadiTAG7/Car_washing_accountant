import { Search, Bell, Calendar, Sun, Moon } from 'lucide-react';
import { useDarkMode } from '../hooks/useDarkMode';

/**
 * Top bar with page title, search, dark-mode toggle, notifications, and date.
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
    numberingSystem: 'latn',
  }).format(today);

  const { darkMode, toggle } = useDarkMode();

  return (
    <header className="sticky top-0 z-20 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 transition-colors duration-200">
      <div className="px-8 py-4 flex items-center justify-between gap-6">
        {/* Title */}
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight">{title}</h1>
          {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}
        </div>

        {/* Right cluster: search + actions + icons + date */}
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative hidden md:block">
            <Search
              size={16}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none"
            />
            <input
              type="search"
              placeholder="بحث..."
              className="w-64 pr-9 pl-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 border border-transparent dark:border-slate-700 focus:bg-white dark:focus:bg-slate-900 focus:border-primary-300 dark:focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:focus:ring-primary-500/20 focus:outline-none text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-all"
            />
          </div>

          {actions}

          {/* Dark mode toggle */}
          <button
            type="button"
            onClick={toggle}
            aria-label={darkMode ? 'تفعيل الوضع الفاتح' : 'تفعيل الوضع الداكن'}
            title={darkMode ? 'الوضع الفاتح' : 'الوضع الداكن'}
            className="relative w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 transition-colors duration-200 overflow-hidden"
          >
            <Sun
              size={18}
              strokeWidth={2.2}
              className={`absolute transition-transform duration-300 ease-out ${darkMode ? 'rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100'}`}
            />
            <Moon
              size={18}
              strokeWidth={2.2}
              className={`absolute transition-transform duration-300 ease-out ${darkMode ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-0 opacity-0'}`}
            />
          </button>

          {/* Notifications */}
          <button
            type="button"
            aria-label="الإشعارات"
            className="relative w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 transition-colors duration-200"
          >
            <Bell size={18} />
            <span className="absolute top-1.5 left-1.5 w-2 h-2 rounded-full bg-red-500 ring-2 ring-white dark:ring-slate-900" />
          </button>

          {/* Date */}
          <div className="hidden lg:flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors duration-200">
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
