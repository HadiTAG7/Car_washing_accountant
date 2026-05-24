import { LogOut, Plus, X } from 'lucide-react';
import { BRAND } from '../data/initialData';
import SweaterLogo from './SweaterLogo';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';

export default function Sidebar({
  tabs,
  activeTab,
  onSelectTab,
  user,
  // onSignOut is still passed by App.jsx for backwards compat but no
  // longer wired — handleLogout below owns the full sign-out lifecycle
  // (Supabase signOut → simulation state cleanup → hard reload).
  // eslint-disable-next-line no-unused-vars
  onSignOut,
  onAddEntry,
  mobileOpen = false,
  onCloseMobile,
}) {
  // Self-contained sign-out: drops the Supabase session, scrubs any
  // partner-view simulation state in localStorage (so the next login
  // doesn't inherit a stale "acting as X" view), then forces a hard
  // reload so the auth gate re-evaluates from a clean slate. Without
  // the reload, components holding on to memoized session state can
  // stay rendered after the JWT is gone.
  async function handleLogout() {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;

      // PartnerViewContext persists the admin's simulate-as selection
      // here; clear it so the next signed-in user starts at zero. The
      // legacy 'partner_view_simulation' key is removed too in case an
      // older build seeded it.
      try { localStorage.removeItem('sweater:actingAsPartnerId'); } catch { /* ignore */ }
      try { localStorage.removeItem('partner_view_simulation');   } catch { /* ignore */ }

      // Hard reload — App.jsx's auth gate now renders the login screen
      // because session === null + requireAuth is on.
      window.location.reload();
    } catch (err) {
      console.error('🔥 Logout Error:', err);
    }
  }
  return (
    <>
      {/* Backdrop — mobile only, visible when drawer is open */}
      <div
        onClick={onCloseMobile}
        className={`md:hidden fixed inset-0 z-30 bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${
          mobileOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden="true"
      />

      <aside
        className={`fixed top-0 right-0 h-screen w-72 md:w-64 bg-primary-900 text-white flex flex-col z-40 shadow-2xl
          transform transition-transform duration-300 ease-out
          ${mobileOpen ? 'translate-x-0' : 'translate-x-full'}
          md:translate-x-0`}
      >
        {/* Logo / brand + mobile close button */}
        <div className="px-6 pt-7 pb-6 border-b border-white/10">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl overflow-hidden shadow-lg">
                <SweaterLogo className="w-full h-full" />
              </div>
              <div className="leading-tight">
                <div className="text-base font-extrabold tracking-tight">{BRAND.nameAr}</div>
                <div className="text-[11px] text-primary-300">{BRAND.nameEn}</div>
              </div>
            </div>

            {/* Close button — mobile only */}
            <button
              type="button"
              onClick={onCloseMobile}
              className="md:hidden text-primary-200 hover:text-white p-1.5 -m-1.5 rounded-lg hover:bg-white/10 transition-colors"
              aria-label="إغلاق القائمة"
            >
              <X size={20} />
            </button>
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
                    className={`w-full flex items-center gap-3 px-3.5 py-3 md:py-2.5 rounded-xl text-sm font-semibold transition-all duration-200
                      ${isActive
                        ? 'bg-white text-primary-900 shadow-lg'
                        : 'text-primary-100 hover:bg-white/10 hover:text-white'}`}
                  >
                    <Icon size={18} strokeWidth={isActive ? 2.5 : 2} />
                    <span className="flex-1 text-right">{label}</span>
                    {isActive && <span className="w-1.5 h-1.5 rounded-full bg-accent-500" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Financial Entry CTA */}
        {onAddEntry && (
          <div className="px-4 pb-3">
            <button
              type="button"
              onClick={onAddEntry}
              className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl bg-gradient-to-l from-accent-500 to-accent-600 hover:from-accent-400 hover:to-accent-500 text-white font-bold text-sm transition-all shadow-lg hover:shadow-xl"
            >
              <Plus size={18} strokeWidth={2.5} />
              إضافة سجل مالي
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="p-4 border-t border-white/10">
          <div className="bg-white/5 rounded-xl p-3 mb-3">
            <p className="text-[11px] text-primary-300 mb-0.5">الحساب الحالي</p>
            <p className="text-sm font-bold truncate" title={user?.email || 'حساب المدير'}>
              {user?.email || 'حساب المدير'}
            </p>
          </div>
          {isSupabaseConfigured && (
            <button
              type="button"
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] text-primary-200 hover:bg-white/10 hover:text-white transition-colors"
            >
              <LogOut size={16} />
              تسجيل الخروج
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
