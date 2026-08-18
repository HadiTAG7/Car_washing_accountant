import { useCallback, useState } from 'react';
import { LogOut, Plus, X, KeyRound, ChevronDown } from 'lucide-react';
import { SweaterWordmark } from './SweaterLogo';
import { signOut as fbSignOut } from 'firebase/auth';
import { auth, isFirebaseConfigured } from '../lib/firebaseClient';
import ChangePasswordModal from './ChangePasswordModal';

// ── طيُّ المجموعات يُحفظ على الجهاز ──
// Same shape as `useDarkMode`'s persistence: an `mw:` key, JSON, and every
// touch wrapped — localStorage throws in private mode and in some embedded
// webviews, and a nav that crashes because it could not remember a
// preference is worse than a nav that forgets.
const COLLAPSE_KEY = 'mw:navCollapsed';

function readCollapsed() {
  try {
    const raw = window.localStorage.getItem(COLLAPSE_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}

export default function Sidebar({
  groups = [],
  activeTab,
  onSelectTab,
  user,
  // onSignOut is still passed by App.jsx for backwards compat but no
  // longer wired — handleLogout below owns the full sign-out lifecycle
  // (Firebase signOut → simulation state cleanup → hard reload).
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
  const [collapsed, setCollapsed] = useState(readCollapsed);

  const toggleGroup = useCallback((groupId) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      try { window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next])); }
      catch { /* localStorage might be blocked */ }
      return next;
    });
  }, []);

  // NON-BLOCKING sign-out. Two reported failure modes informed this
  // shape:
  //   (a) `await signOut()` was hanging on slow/expired
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
    fbSignOut(auth).catch((err) => {
      console.error('Background signout log:', err);
    });

    // 2. Synchronous, TARGETED client wipe — auth/session state only.
    //    The previous blanket localStorage.clear() also nuked per-device
    //    UI prefs that have nothing to do with auth (dark-mode choice,
    //    hidden budget cards), which reset on every logout. We now
    //    remove: every Firebase auth token (and legacy 'sb-' keys) and
    //    the admin's simulate-as-partner pick. sessionStorage stays
    //    fully cleared (nothing persistent lives there).
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('firebase:') || k.startsWith('sb-') || k === 'sweater:actingAsPartnerId')
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

      {/* Navigation rail. Per the design system the brand colour marks
          emphasis, not surfaces — so the rail is a calm white / #292929
          panel and orange appears only on the active item and the CTA. */}
      <aside
        className={`fixed top-0 right-0 h-screen w-72 md:w-64 bg-white dark:bg-slate-900 border-l border-slate-100 dark:border-slate-800 flex flex-col z-40
          transform transition-transform duration-300 ease-out
          ${mobileOpen ? 'translate-x-0' : 'translate-x-full'}
          md:translate-x-0`}
        style={{ boxShadow: 'var(--sw-shadow-card)' }}
      >
        {/* Official brand lockup + mobile close button */}
        <div className="px-5 pt-6 pb-5 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between gap-3">
            <SweaterWordmark className="h-9 w-auto" />
            {/* Close button — mobile only */}
            <button
              type="button"
              onClick={onCloseMobile}
              className="sw-tap md:hidden text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1.5 -m-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center justify-center"
              aria-label="إغلاق القائمة"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {groups.map((group) => {
            const holdsActive = group.tabs.some((t) => t.id === activeTab);
            // ── المجموعة النشطة تُعرض مفتوحةً ولو كانت مطويّة ──
            // An override at RENDER time, not a write to the preference: the
            // group re-collapses the moment the user navigates away. Without
            // it the active tab — and the orange bar marking it — could sit
            // hidden behind a folded header, and the nav would be lying about
            // where the user is.
            const isOpen = !collapsed.has(group.id) || holdsActive;
            return (
              <div key={group.id}>
                {group.title && (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    aria-expanded={isOpen}
                    className="w-full flex items-center gap-2 px-3 py-2 text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                  >
                    <ChevronDown
                      size={13}
                      className={`transition-transform duration-200 ${isOpen ? '' : '-rotate-90'}`}
                    />
                    <span className="flex-1 text-right">{group.title}</span>
                  </button>
                )}
                {isOpen && (
                  <ul className="space-y-0.5">
                    {group.tabs.map(({ id, label, icon: Icon }) => {
                      const isActive = activeTab === id;
                      return (
                        <li key={id}>
                          <button
                            type="button"
                            onClick={() => onSelectTab(id)}
                            aria-current={isActive ? 'page' : undefined}
                            className={`relative w-full flex items-center gap-3 px-3.5 py-3 md:py-2.5 text-sm font-semibold transition-colors duration-200
                              ${isActive
                                ? 'bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300'
                                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                            style={{ borderRadius: 'var(--sw-radius-control)', minHeight: 'var(--sw-tap-min)' }}
                          >
                            {/* Brand bar marks the active route (RTL: right edge). */}
                            {isActive && (
                              <span
                                className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary-500"
                                style={{ borderRadius: 'var(--sw-radius-round)' }}
                              />
                            )}
                            <Icon size={18} strokeWidth={isActive ? 2.4 : 2} />
                            <span className="flex-1 text-right">{label}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </nav>

        {/* Financial Entry CTA — the system's pill action button */}
        {onAddEntry && (
          <div className="px-4 pb-3">
            <button
              type="button"
              onClick={onAddEntry}
              className="sw-button sw-button--sm sw-button--primary w-full"
            >
              <Plus size={18} strokeWidth={2.5} />
              إضافة سجل مالي
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800">
          <div
            className="bg-slate-50 dark:bg-slate-800 p-3 mb-2 border border-slate-100 dark:border-slate-700"
            style={{ borderRadius: 'var(--sw-radius-control)' }}
          >
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">الحساب الحالي</p>
            <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate" title={user?.email || 'حساب المدير'}>
              {user?.email || 'حساب المدير'}
            </p>
          </div>
          {isFirebaseConfigured && (
            <>
              <button
                type="button"
                onClick={() => setChangePasswordOpen(true)}
                className="w-full min-h-11 flex items-center gap-2 px-3 py-2.5 rounded-control text-[13px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 transition-colors cursor-pointer"
              >
                <KeyRound size={16} />
                تغيير كلمة المرور
              </button>
              <button
                type="button"
                onClick={handleAbsoluteLogout}
                className="w-full min-h-11 flex items-center gap-2 px-3 py-2.5 rounded-control text-[13px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 transition-colors cursor-pointer"
              >
                <LogOut size={16} />
                تسجيل الخروج
              </button>
            </>
          )}
          {/* Legal / ownership line — owner name appears here only. */}
          <p className="mt-3 px-1 text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
            © {new Date().getFullYear()} شركة هادي الغانم
          </p>
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
