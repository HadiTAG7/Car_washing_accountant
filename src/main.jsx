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
void boot().catch(() => {
  console.error('[sweater-ui] boot-failed');
  window.SweaterRecovery?.show('boot');
});

// PWA: register the (network-only) service worker so the dashboard is
// installable. Production builds only — a SW on the dev server interferes
// with Vite's module reloading.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}
