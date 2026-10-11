import { createContext, useCallback, useContext, useState } from 'react';

/**
 * MobileMenuContext — shares the off-canvas drawer's open/closed state
 * between App.jsx (which renders the Sidebar drawer) and TopBar (which
 * renders the hamburger button inside every page). The persistent desktop
 * visibility preference is separate, so hiding the rail never disables
 * the mobile drawer. Storage contains a UI preference only.
 */
const MobileMenuContext = createContext({
  open: false,
  setOpen: () => {},
  toggle: () => {},
  desktopHidden: false,
  toggleDesktop: () => {},
});

const DESKTOP_SIDEBAR_KEY = 'sweater:sidebar-hidden';
function readDesktopHidden() {
  try { return window.localStorage.getItem(DESKTOP_SIDEBAR_KEY) === 'true'; }
  catch { return false; }
}

export function MobileMenuProvider({ children }) {
  const [open, setOpen] = useState(false);
  const [desktopHidden, setDesktopHidden] = useState(readDesktopHidden);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  const toggleDesktop = useCallback(() => setDesktopHidden(previous => {
    const next = !previous;
    try { window.localStorage.setItem(DESKTOP_SIDEBAR_KEY, String(next)); }
    catch { /* A blocked preference store must not disable navigation. */ }
    return next;
  }), []);
  return (
    <MobileMenuContext.Provider value={{ open, setOpen, toggle, desktopHidden, toggleDesktop }}>
      {children}
    </MobileMenuContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useMobileMenu() {
  return useContext(MobileMenuContext);
}
