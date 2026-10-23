// Isolated synthetic preview: every backend hook is replaced, including seller and declaration reads.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import config from '../vite.config.js';
const base = await config({ mode: 'development', command: 'serve' });
const fixture = fileURLToPath(new URL('./vat-dashboard-preview/data.jsx', import.meta.url));
const server = await createServer({ ...base, configFile: false,
  resolve: { alias: [
    { find: /^(\.\.\/|\.\.\/\.\.\/)(hooks\/(useTaxInvoices|useStartupCosts|useAnnualExpenses|useMonthlyExpenses|useVariableExpenses|useWashes|useLedger|useAccountingSettings|useSweater|useVatDeclarations|useFirestoreQuery)|contexts\/PartnerViewContext|lib\/firebaseClient|lib\/accounting\/firestoreInvoicing)$/, replacement: fixture },
    { find: /^\.\/TopBar$/, replacement: fixture }, ...base.resolve.alias,
  ] }, server: { host: '127.0.0.1', port: 5210, strictPort: true } });
await server.listen(); server.printUrls();
