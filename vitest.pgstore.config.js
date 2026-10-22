// The server's Firestore tests, run unchanged on Postgres through pgstore.
//   npx supabase start && npm run test:functions:pg
import { defineConfig } from 'vitest/config';
import { modulePath } from './scripts/module-paths.mjs';

const here = modulePath('.', import.meta.url);
export default defineConfig({
  resolve: {
    alias: [
      { find: /^firebase-admin\/firestore$/, replacement: `${here}server/db/pgstore/testing/firestore.js` },
      { find: /^firebase-admin\/app$/, replacement: `${here}server/db/pgstore/testing/app.js` },
    ],
  },
  test: {
    setupFiles: [`${here}server/db/pgstore/testing/setup.js`],
    // An emulator-shaped host so the emulator-gated suites run; PGSTORE_TESTS marks this backend.
    env: { FIRESTORE_EMULATOR_HOST: '127.0.0.1:1', GCLOUD_PROJECT: 'demo-sweater', PGSTORE_TESTS: '1' },
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
