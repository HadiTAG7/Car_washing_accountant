// Fully synthetic: no production data client or write adapter is loaded.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import config from '../vite.config.js';
const base = await config({ mode: 'development', command: 'serve' });
const fixture = fileURLToPath(new URL('./fixed-assets-preview/data.jsx', import.meta.url));
const server = await createServer({ ...base, configFile: false, resolve: { alias: [
  { find: /^(\.\.\/|\.\.\/\.\.\/)(hooks\/(useFixedAssets|useAuth)|contexts\/PartnerViewContext|lib\/(firebaseClient|accounting\/firestoreAssets))$/, replacement: fixture },
  { find: /^\.\/TopBar$/, replacement: fixture }, ...base.resolve.alias,
] }, server: { host: '127.0.0.1', port: 5221, strictPort: true } });
await server.listen(); server.printUrls();
