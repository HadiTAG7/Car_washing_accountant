import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import LanguageProvider from './i18n/LanguageProvider.jsx'

async function boot() {
  // The diagnostic route loads no Auth or financial modules, even while signed out.
  const diagnostic = new URLSearchParams(window.location.search).get('storageDiagnostic') === '1';
  const { default: Root } = diagnostic
    ? await import('./components/StorageDiagnostic.jsx')
    : await import('./App.jsx');
  createRoot(document.getElementById('root')).render(
    <StrictMode><LanguageProvider><Root /></LanguageProvider></StrictMode>,
  );
}
void boot();

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
