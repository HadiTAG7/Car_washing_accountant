import { useCallback, useEffect, useRef, useState } from 'react';
import { LanguageContext } from './LanguageContext';
import { LANGUAGE_KEY, readLanguage, loadEnglish, setLanguage as setActiveLanguage } from './locale';

export default function LanguageProvider({ children }) {
  const [language, updateLanguage] = useState('ar');
  const [pending, setPending] = useState(() => readLanguage() === 'en');
  const [ready, setReady] = useState(() => readLanguage() !== 'en');
  const [error, setError] = useState('');
  const requestId = useRef(0);
  const changeLanguage = useCallback(async next => {
    if (!['ar', 'en'].includes(next)) return;
    setPending(true);
    setError('');
    const id = ++requestId.current;
    try {
      if (next === 'en') await loadEnglish();
      if (id !== requestId.current) return;
      setActiveLanguage(next);
      updateLanguage(next);
      setReady(true);
      try { window.localStorage.setItem(LANGUAGE_KEY, next); } catch { /* blocked storage */ }
    } catch {
      if (id !== requestId.current) return;
      setError('تعذّر تحميل اللغة. أعد المحاولة. / Unable to load the language. Please try again.');
      setReady(true);
    } finally { if (id === requestId.current) setPending(false); }
  }, []);
  useEffect(() => {
    const initial = readLanguage();
    if (initial === 'en') void changeLanguage(initial);
    else setActiveLanguage('ar');
    const sync = event => {
      if (event.key === LANGUAGE_KEY) void changeLanguage(event.newValue === 'en' ? 'en' : 'ar');
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [changeLanguage]);
  useEffect(() => {
    const direction = language === 'en' ? 'ltr' : 'rtl';
    document.documentElement.lang = language;
    document.documentElement.dir = direction;
    document.title = language === 'en' ? 'Sweater | Accounting and Partner Management' : 'سويتر | نظام إدارة القيود والشركاء';
  }, [language]);
  return (
    <LanguageContext.Provider value={{ language, pending, changeLanguage }}>
      {error && <div role="alert" className="p-3 text-center text-red-600">{error}</div>}
      {ready ? children : <div role="status" className="min-h-screen flex items-center justify-center">Loading English… / جارٍ تحميل الإنجليزية…</div>}
    </LanguageContext.Provider>
  );
}
