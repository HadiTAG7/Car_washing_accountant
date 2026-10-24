// No live backend: all auth/data seams below use synthetic read-only fixtures.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import config from '../vite.config.js';
const base = await config({ mode: 'development', command: 'serve' });
const fixture = fileURLToPath(new URL('./workbench-design-preview/data.jsx', import.meta.url));
const server = await createServer({ ...base, configFile: false, resolve: { alias: [
  { find: /^\.\.\/(hooks\/(useAuth|useFinanceRead)|lib\/(financeApi|firebaseClient))$/, replacement: fixture },
  { find: /^\.\/(AdminPartnerSelector|ChangePasswordModal)$/, replacement: fixture }, ...base.resolve.alias,
] }, server: { host: '127.0.0.1', port: 5241, strictPort: true } });
await server.listen(); server.printUrls();
