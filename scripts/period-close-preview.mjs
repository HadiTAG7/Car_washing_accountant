// Every backend/hook seam is replaced; only synthetic records can be changed.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import config from '../vite.config.js';
const base = await config({ mode: 'development', command: 'serve' });
const fixture = fileURLToPath(new URL('./period-close-preview/data.jsx', import.meta.url));
const server = await createServer({ ...base, configFile: false, resolve: { alias: [
  { find: /^(\.\.\/|\.\.\/\.\.\/)(hooks\/(useLedger|useAuth|useAccountingSettings|useFirestoreQuery)|contexts\/PartnerViewContext|lib\/(firebaseClient|accounting\/(firestoreLedger|firestoreRecurring|firestoreInvoicing|postOperations)))$/, replacement: fixture },
  { find: /^\.\/TopBar$/, replacement: fixture }, ...base.resolve.alias,
] }, server: { host: '127.0.0.1', port: 5222, strictPort: true } });
await server.listen(); server.printUrls();
