// The monthly reconciliation (Stage 5): the site's own code on Firebase (an
// emulator loaded from the export) and on Supabase (pgstore and the browser
// layer). firebase/* resolves to the browser layer, as in a Supabase build;
// firebase-admin stays real, for the emulator side.
//   firebase emulators:exec --only firestore --project demo-sweater --config firebase.test.json \
//     "RECONCILE_DIR=migration-data vitest run -c vitest.reconcile.config.js"
import { defineConfig } from 'vitest/config';
import { modulePath } from './scripts/module-paths.mjs';
import { execFileSync } from 'node:child_process';

// The local project's URL and public key, so the app's own client (created at
// import, as in the browser) is the one that signs in and reads.
const local = Object.fromEntries(execFileSync('npx', ['supabase', 'status', '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  .split('\n').map(l => /^([A-Z_]+)="?(.*?)"?$/.exec(l.trim())).filter(Boolean).map(m => [m[1], m[2]]));

const here = modulePath('.', import.meta.url);
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
    env: { VITE_DATA_SOURCE: 'supabase', VITE_SUPABASE_URL: local.API_URL, VITE_SUPABASE_ANON_KEY: local.ANON_KEY },
    testTimeout: 3_600_000,
    hookTimeout: 600_000,
  },
});
