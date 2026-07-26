import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'mw:darkMode';

function readInitial() {
  if (typeof window === 'undefined') return false;
  // The inline no-flash script in index.html has already set the `.dark`
  // class based on localStorage / system preference, so we trust that
  // as the source of truth for the initial state.
  return document.documentElement.classList.contains('dark');
}

export function useDarkMode() {
  const [darkMode, setDarkModeState] = useState(readInitial);

  // Keep <html>.dark, [data-theme] and localStorage in sync going forward.
  // The `.dark` class drives Tailwind's dark: variants; [data-theme] is
  // what the Sweater Design System's token layer keys off. Both are set
  // so neither styling mechanism can fall out of step with the other.
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
    root.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    try { window.localStorage.setItem(STORAGE_KEY, String(darkMode)); }
    catch { /* localStorage might be blocked */ }
  }, [darkMode]);

  const setDarkMode = useCallback((next) => {
    setDarkModeState((prev) =>
      typeof next === 'function' ? next(prev) : Boolean(next),
    );
  }, []);

  const toggle = useCallback(() => setDarkModeState((v) => !v), []);

  return { darkMode, setDarkMode, toggle };
}
