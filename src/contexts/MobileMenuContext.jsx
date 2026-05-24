import { createContext, useCallback, useContext, useState } from 'react';

/**
 * MobileMenuContext — shares the off-canvas drawer's open/closed state
 * between App.jsx (which renders the Sidebar drawer) and TopBar (which
 * renders the hamburger button inside every page). Mirrors the shape of
 * useDarkMode: { open, setOpen, toggle }.
 */
const MobileMenuContext = createContext({
  open: false,
  setOpen: () => {},
  toggle: () => {},
});

export function MobileMenuProvider({ children }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  return (
    <MobileMenuContext.Provider value={{ open, setOpen, toggle }}>
      {children}
    </MobileMenuContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useMobileMenu() {
  return useContext(MobileMenuContext);
}
