import { useState } from 'react';
import { LogOut, Plus, X, KeyRound } from 'lucide-react';
import { BRAND } from '../data/initialData';
import SweaterLogo from './SweaterLogo';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import ChangePasswordModal from './ChangePasswordModal';

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
  // Modal for in-app password change — opened from the footer "تغيير
  // كلمة المرور" button. Distinct from the email-based forgot-password
  // flow on LoginScreen.
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  // NON-BLOCKING sign-out. Two reported failure modes informed this
  // shape:
  //   (a) `await supabase.auth.signOut()` was hanging on slow/expired
  //       sessions, blocking the storage wipe and navigation that
  //       should fire unconditionally → handler is now a plain (non-
  //       async) function, and the server call is detached as
  //       fire-and-forget so a hung network never freezes the UI.
  //   (b) `window.location.href = origin` had no visible effect when
  //       the app was running inside a same-origin preview iframe
  //       (the inner frame navigated but the user kept seeing the
  //       parent's stale shell) → we try `window.top` first to break
  //       out of the iframe, fall back to the current frame, use
  //       `.replace()` so the logout doesn't pollute history, and
  //       append a `?signedOut=<ts>` query so the destination URL is
  //       *guaranteed* different from the current URL (defeats the
  //       browser's same-URL nav dedup). App.jsx watches for that
  //       query param and forces the LoginScreen regardless of the
  //       VITE_REQUIRE_AUTH flag.
  function handleAbsoluteLogout(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    // Visible breadcrumb in the browser tab so the user can confirm
    // the click was received even if the subsequent navigation is
    // blocked by a hostile iframe sandbox. Cheap and idempotent.
    try { document.title = 'جارٍ تسجيل الخروج…'; } catch { /* no-op */ }
    console.info('[logout] handler fired');

    // 1. Detached server call — never awaited, never blocking.
    supabase.auth.signOut().catch((err) => {
      console.error('Background signout log:', err);
    });

    // 2. Synchronous, TARGETED client wipe — auth/session state only.
    //    The previous blanket localStorage.clear() also nuked per-device
    //    UI prefs that have nothing to do with auth (dark-mode choice,
    //    hidden budget cards), which reset on every logout. We now
    //    remove: every Supabase auth token (keys prefixed 'sb-') and
    //    the admin's simulate-as-partner pick. sessionStorage stays
    //    fully cleared (nothing persistent lives there).
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('sb-') || k === 'sweater:actingAsPartnerId')
        .forEach((k) => localStorage.removeItem(k));
    } catch (err) { console.error('localStorage cleanup failed:', err); }
    try { sessionStorage.clear(); } catch (err) { console.error('sessionStorage.clear failed:', err); }

    // 3. Build a destination URL that's *different* from the current
    //    URL by a query timestamp. Some browsers no-op `location.href`
    //    assignments that resolve to the exact same URL — the ?ts
    //    suffix bypasses that.
    const target = `${window.location.origin}/?signedOut=${Date.now()}`;

    // 4. Aggressive navigation cascade:
    //    a. Try to navigate the TOP frame (breaks out of preview
    //       iframes like Lovable). Wrapped in try/catch because
    //       accessing `window.top.location` cross-origin throws
    //       SecurityError.
    //    b. Fall back to the current frame.
    //    c. `.replace()` over `.href` so the dashboard doesn't sit in
    //       history (back button would otherwise revisit it).
    try {
      if (window.top && window.top !== window) {
        window.top.location.replace(target);
        return;
      }
    } catch { /* cross-origin top access blocked — fall through */ }
    window.location.replace(target);
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
            <>
              <button
                type="button"
                onClick={() => setChangePasswordOpen(true)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] text-primary-200 hover:bg-white/10 hover:text-white transition-colors cursor-pointer mb-1"
              >
                <KeyRound size={16} />
                تغيير كلمة المرور
              </button>
              <button
                type="button"
                onClick={handleAbsoluteLogout}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] text-primary-200 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
              >
                <LogOut size={16} />
                تسجيل الخروج
              </button>
            </>
          )}
        </div>
      </aside>

      <ChangePasswordModal
        isOpen={changePasswordOpen}
        onClose={() => setChangePasswordOpen(false)}
        userEmail={user?.email}
      />
    </>
  );
}
