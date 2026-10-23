// Synthetic-only, no production authentication, data connections or mutations.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import config from '../vite.config.js';
const base = await config({ mode: 'development', command: 'serve' });
const fixture = fileURLToPath(new URL('./ledger-controls-preview/data.jsx', import.meta.url));
const server = await createServer({ ...base, configFile: false, resolve: { alias: [
  { find: /^(\.\.\/|\.\.\/\.\.\/)(hooks\/(useLedger|useLedgerSourceDocuments)|lib\/firebaseClient)$/, replacement: fixture },
  { find: /^\.\/TopBar$/, replacement: fixture }, ...base.resolve.alias,
] }, server: { host: '127.0.0.1', port: 5214, strictPort: true } });
await server.listen(); server.printUrls();
