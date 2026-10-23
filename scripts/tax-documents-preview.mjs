// Synthetic browser fixture only. Every data/auth/write adapter is replaced.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import config from '../vite.config.js';
const base = await config({ mode: 'development', command: 'serve' });
const fixture = fileURLToPath(new URL('./tax-documents-preview/data.jsx', import.meta.url));
const topbar = fileURLToPath(new URL('./tax-documents-preview/topbar.jsx', import.meta.url));
const server = await createServer({ ...base, configFile: false, resolve: { alias: [
  { find: /^(\.\.\/|\.\.\/\.\.\/)(hooks\/(useSalesDocuments|useAccountingSettings|useBikers|useAuth|useWashes|useLedger|useFirestoreQuery)|contexts\/PartnerViewContext|lib\/(firebaseClient|accounting\/(firestoreInvoicing|firestoreLedger)))$/, replacement: fixture },
  { find: /^\.\/TopBar$/, replacement: topbar }, ...base.resolve.alias,
] }, server: { host: '127.0.0.1', port: 5219, strictPort: true } });
await server.listen(); server.printUrls();
