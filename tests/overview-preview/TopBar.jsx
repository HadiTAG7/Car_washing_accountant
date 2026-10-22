import { useLanguage } from '../../src/i18n/useLanguage';
export default function PreviewTopBar() {
  const { language, changeLanguage } = useLanguage();
  return <header style={{ padding: 16, display: 'flex', gap: 20, flexWrap: 'wrap', borderBottom: '1px solid var(--sw-border-subtle)', position: 'sticky', top: 0, background: 'var(--sw-surface)', zIndex: 5 }}>
    <strong>{language === 'en' ? 'Isolated visual test · reference totals, synthetic workers · no production connection' : 'معاينة اختبار معزولة · أرقام مرجعية وبايكرز وهميون · لا اتصال بالإنتاج'}</strong>
    <button type="button" onClick={() => changeLanguage(language === 'en' ? 'ar' : 'en')}>{language === 'en' ? 'العربية' : 'English'}</button>
    <button type="button" onClick={() => { const dark = document.documentElement.classList.toggle('dark'); document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }}>{language === 'en' ? 'Light / dark' : 'فاتح / داكن'}</button>
  </header>;
}
