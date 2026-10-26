import { createRoot } from 'react-dom/client';
import LanguageProvider from '../../src/i18n/LanguageProvider';
import VatRecoveryPage from '../../src/components/VatRecoveryPage';
import '../../src/index.css';
createRoot(document.getElementById('root')).render(<LanguageProvider><VatRecoveryPage /></LanguageProvider>);
