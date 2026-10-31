import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageContext } from '../../src/i18n/LanguageContext';
import { loadEnglish } from '../../src/i18n/locale';
import SweaterBookingDetails from '../../src/components/SweaterBookingDetails';
import '../../src/index.css';

// Synthetic data only. The Vite test configuration replaces both read hooks;
// no auth, database, SSP, integration sender or mutation endpoint is imported.
function Preview() {
  const [language, setLanguage] = useState(new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'ar');
  const [open, setOpen] = useState(true);
  return <LanguageContext.Provider value={{ language }}><div style={{ padding: 24 }}>
    <p>Isolated synthetic preview — no database or SSP connection</p>
    <button onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}>Arabic / English</button>
    <button onClick={() => setOpen(true)}>Open test details</button>
    {open && <SweaterBookingDetails booking={{ record: { sspBookingId: 'B-101', rawStatus: 'Initiated' } }} onClose={() => setOpen(false)} />}
  </div></LanguageContext.Provider>;
}
loadEnglish().then(() => { document.documentElement.classList.add('dark'); createRoot(document.getElementById('root')).render(<Preview />); });
