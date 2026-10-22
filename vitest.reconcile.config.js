// The monthly reconciliation (Stage 5): the site's own code on Firebase (an
// emulator loaded from the export) and on Supabase (pgstore and the browser
// layer). firebase/* resolves to the browser layer, as in a Supabase build;
// firebase-admin stays real, for the emulator side.
//   firebase emulators:exec --only firestore --project demo-sweater --config firebase.test.json \
//     "RECONCILE_DIR=migration-data vitest run -c vitest.reconcile.config.js"
import { defineConfig } from 'vitest/config';

const here = new URL('.', import.meta.url).pathname;
const MODULES = ['app', 'firestore', 'auth', 'functions', 'storage'];
export default defineConfig({
  resolve: {
    alias: [
      { find: '@sweater/i18n', replacement: `${here}src/i18n` },
      ...MODULES.map(m => ({ find: new RegExp(`^firebase/${m}$`), replacement: `${here}src/lib/data/supabase/${m}.js` })),
    ],
  },
  test: {
    include: ['scripts/migration/reconcile/**/*.test.js'],
    env: { VITE_DATA_SOURCE: 'supabase', VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_ANON_KEY: 'set-at-runtime' },
    testTimeout: 3_600_000,
    hookTimeout: 600_000,
  },
});
