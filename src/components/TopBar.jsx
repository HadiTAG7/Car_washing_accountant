import { Calendar, Sun, Moon, Menu } from 'lucide-react';
import { useDarkMode } from '../hooks/useDarkMode';
import { useAuth } from '../hooks/useAuth';
import { useMobileMenu } from '../contexts/MobileMenuContext';
import AdminPartnerSelector from './AdminPartnerSelector';

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
  const { toggle: toggleMobileMenu } = useMobileMenu();
  const { session } = useAuth();

  return (
    <header className="sticky top-0 z-20 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 transition-colors duration-200">
      <div className="px-4 sm:px-6 lg:px-8 py-3 sm:py-4 flex items-center justify-between gap-3 sm:gap-6">
        {/* Title */}
        <div className="min-w-0 flex-1">
          <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight truncate">{title}</h1>
          {subtitle && <p className="hidden sm:block text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">{subtitle}</p>}
        </div>

        {/* Right cluster: hamburger (mobile) + actions + icons + date.
            No search box and no notifications bell — neither feature
            exists behind them, and dead controls erode trust in the
            ones that work. */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Admin-only: simulate-as-partner dropdown. Renders null for
              partners (and when there are no active partners). */}
          <AdminPartnerSelector />

          {actions}

          {/* Dark mode toggle */}
          <button
            type="button"
            onClick={toggle}
            aria-label={darkMode ? 'تفعيل الوضع الفاتح' : 'تفعيل الوضع الداكن'}
            title={darkMode ? 'الوضع الفاتح' : 'الوضع الداكن'}
            className="sw-tap relative w-10 h-10 rounded-lg bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-100 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 transition-colors duration-200 overflow-hidden shrink-0"
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

          {/* Date */}
          <div className="hidden lg:flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-300 transition-colors duration-200 shrink-0">
            <Calendar size={16} />
            <span className="text-xs font-medium whitespace-nowrap">{formatted}</span>
          </div>

          {/* Avatar — the signed-in user's initial (email's first letter),
              falling back to the brand initial in demo mode. */}
          <div
            className="hidden sm:flex w-10 h-10 rounded-lg bg-primary-700 items-center justify-center text-white font-bold text-sm shrink-0 uppercase"
            title={session?.user?.email || 'وضع العرض التجريبي'}
          >
            {(session?.user?.email || 'س').trim().charAt(0)}
          </div>

          {/* Hamburger — mobile only, on the far edge (left in RTL) */}
          <button
            type="button"
            onClick={toggleMobileMenu}
            aria-label="فتح القائمة"
            className="sw-tap md:hidden w-10 h-10 rounded-lg bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-100 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 transition-colors duration-200 shrink-0"
          >
            <Menu size={20} />
          </button>
        </div>
      </div>
    </header>
  );
}
