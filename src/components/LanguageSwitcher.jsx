import { Languages } from 'lucide-react';
import { useLanguage } from '../i18n/useLanguage';

export default function LanguageSwitcher() {
  const { language, pending, changeLanguage } = useLanguage();
  return (
    <button type="button" onClick={() => void changeLanguage(language === 'ar' ? 'en' : 'ar')}
      disabled={pending} aria-label={language === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}
      title={language === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}
      className="sw-tap inline-flex items-center justify-center gap-1.5 min-h-10 rounded-lg px-2.5 text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 disabled:opacity-60 shrink-0"
      translate="no" dir="ltr">
      <Languages size={16} />
      <span translate="no">{pending ? '…' : language === 'ar' ? 'English' : 'العربية'}</span>
    </button>
  );
}
