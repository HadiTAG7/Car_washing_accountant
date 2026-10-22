import { createRoot } from 'react-dom/client';
import LanguageProvider from '../../src/i18n/LanguageProvider';
import OverviewPage from '../../src/components/OverviewPage';
import '../../src/index.css';
createRoot(document.getElementById('root')).render(<LanguageProvider><OverviewPage onNavigate={tab => { document.getElementById('preview-navigation').textContent = tab; }} /><output id="preview-navigation" aria-label="Test navigation" /></LanguageProvider>);
