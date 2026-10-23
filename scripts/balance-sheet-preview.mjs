// Isolated synthetic rendering. No production connection or write adapter.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import config from '../vite.config.js';
const base = await config({ mode: 'development', command: 'serve' });
const fixture = fileURLToPath(new URL('./balance-sheet-preview/data.jsx', import.meta.url));
const server = await createServer({ ...base, configFile: false, resolve: { alias: [
  { find: /^(\.\.\/|\.\.\/\.\.\/)(hooks\/(useLedger|useBalanceAssetSources|useIncomeStatementSources|useIncomePayrollPreviews|useAccountingSettings|useFinanceRead|useFeeRules|useLedgerSourceDocuments)|contexts\/PartnerViewContext|lib\/firebaseClient)$/, replacement: fixture },
  { find: /^\.\/TopBar$/, replacement: fixture }, ...base.resolve.alias,
] }, server: { host: '127.0.0.1', port: 5217, strictPort: true } });
await server.listen(); server.printUrls();
