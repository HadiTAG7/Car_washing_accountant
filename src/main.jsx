import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import LanguageProvider from './i18n/LanguageProvider.jsx'
import AppErrorBoundary from './components/AppErrorBoundary.jsx'
import AppMounted from './components/AppMounted.jsx'

async function boot() {
  // The diagnostic route loads no Auth or financial modules, even while signed out.
  const diagnostic = new URLSearchParams(window.location.search).get('storageDiagnostic') === '1';
  const { default: Root } = diagnostic
    ? await import('./components/StorageDiagnostic.jsx')
    : await import('./App.jsx');
  createRoot(document.getElementById('root')).render(
    <StrictMode><AppErrorBoundary><AppMounted><LanguageProvider><Root /></LanguageProvider></AppMounted></AppErrorBoundary></StrictMode>,
  );
}
void boot().catch((error) => {
  console.error('[sweater-ui] boot-failed');
  try { window.SweaterDiagnostics?.record('boot', error); } catch { /* Keep the independent recovery available. */ }
  window.SweaterRecovery?.show('boot');
});

// Cache hashed UI code only to keep an already-open release usable after a
// deployment. HTML, API/auth responses and business data remain network-only.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}
