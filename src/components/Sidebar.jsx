import { Droplet, LogOut } from 'lucide-react';
import { BRAND } from '../data/initialData';

/**
 * Fixed right-side sidebar navigation.
 *
 * Props:
 *   tabs          Array of { id, label, icon, description? }
 *   activeTab     currently-selected tab id
 *   onSelectTab   (id) => void
 */
export default function Sidebar({ tabs, activeTab, onSelectTab }) {
  return (
    <aside className="fixed top-0 right-0 h-screen w-64 bg-primary-900 text-white flex flex-col z-30 shadow-2xl">
      {/* Logo / brand */}
      <div className="px-6 pt-7 pb-6 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-br from-primary-400 to-primary-600 w-11 h-11 rounded-xl flex items-center justify-center shadow-lg">
            <Droplet size={22} className="text-white" strokeWidth={2.5} />
          </div>
          <div className="leading-tight">
            <div className="text-base font-extrabold tracking-tight">{BRAND.nameAr}</div>
            <div className="text-[11px] text-primary-300">{BRAND.nameEn}</div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-5">
        <p className="text-[10px] font-semibold text-primary-400 uppercase tracking-widest px-3 mb-2">
          القائمة الرئيسية
        </p>
        <ul className="space-y-1">
          {tabs.map(({ id, label, icon: Icon }) => {
            const isActive = activeTab === id;
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => onSelectTab(id)}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200
                    ${isActive
                      ? 'bg-white text-primary-900 shadow-lg'
                      : 'text-primary-100 hover:bg-white/10 hover:text-white'}`}
                >
                  <Icon size={18} strokeWidth={isActive ? 2.5 : 2} />
                  <span className="flex-1 text-right">{label}</span>
                  {isActive && <span className="w-1.5 h-1.5 rounded-full bg-primary-500" />}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-white/10">
        <div className="bg-white/5 rounded-xl p-3 mb-3">
          <p className="text-[11px] text-primary-300 mb-0.5">حساب المدير</p>
          <p className="text-sm font-bold">أحمد الراجحي</p>
        </div>
        <button
          type="button"
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] text-primary-200 hover:bg-white/10 hover:text-white transition-colors"
        >
          <LogOut size={16} />
          تسجيل الخروج
        </button>
      </div>
    </aside>
  );
}
