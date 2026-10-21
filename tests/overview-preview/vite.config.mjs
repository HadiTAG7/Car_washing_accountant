import { defineConfig, mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import base from '../../vite.config.js';
// Separate test entry/config, never imported by the production application.
export default mergeConfig(base, defineConfig({
  appType: 'mpa',
  plugins: [{ name: 'isolated-overview-visual-fixture', enforce: 'pre',
    load(id) {
      const path = id.replaceAll('\\', '/').split('?')[0];
      if (path.endsWith('/src/hooks/useOverviewDashboard.js')) return 'export { useOverviewDashboard } from "/tests/overview-preview/fixture.js";';
      if (path.endsWith('/src/contexts/PartnerViewContext.jsx')) return 'export const usePartnerView = () => ({ role: "admin", canMutate: false, isPartnerView: false });';
      if (path.endsWith('/src/components/TopBar.jsx')) return 'export { default } from "/tests/overview-preview/TopBar.jsx";';
      if (path.endsWith('/src/components/OverviewBikerQuality.jsx')) return 'export default function Quality() { return null; }';
    },
    transform(code, id) {
      if (id.replaceAll('\\', '/').endsWith('/src/components/OverviewPage.jsx')) return code
        .replace("from '../lib/firebaseClient'", "from '/tests/overview-preview/environment.js'")
        .replace("from '../lib/bikerProfile'", "from '/tests/overview-preview/environment.js'");
    },
  }],
  server: { host: '127.0.0.1', port: 5201, strictPort: true },
  preview: { host: '127.0.0.1', port: 5201, strictPort: true },
  build: { outDir: '.test-runtime/overview-preview', rolldownOptions: { input: fileURLToPath(new URL('./index.html', import.meta.url)) } },
}));
