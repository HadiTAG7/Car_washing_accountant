// Synthetic-only read preview. Never connects to production or saves records.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import config from '../vite.config.js';
const base = await config({ mode: 'development', command: 'serve' });
const fixture = fileURLToPath(new URL('./trial-balance-preview/data.jsx', import.meta.url));
const server = await createServer({ ...base, configFile: false, resolve: { alias: [
  { find: /^(\.\.\/|\.\.\/\.\.\/)(hooks\/(useLedger|useTrialReconciliation|useLedgerSourceDocuments)|contexts\/PartnerViewContext|lib\/firebaseClient)$/, replacement: fixture },
  { find: /^\.\/TopBar$/, replacement: fixture }, ...base.resolve.alias,
] }, server: { host: '127.0.0.1', port: 5216, strictPort: true } });
await server.listen(); server.printUrls();
