// Synthetic, read-only UI fixture: every app data hook is replaced; no backend.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import config from '../vite.config.js';
const base = await config({ mode: 'development', command: 'serve' });
const fixture = fileURLToPath(new URL('./income-reconciliation-preview/data.jsx', import.meta.url));
const server = await createServer({ ...base, configFile: false,
  resolve: { alias: [
    { find: /^(\.\.\/|\.\.\/\.\.\/)(hooks\/(useBikers|useLedger|useFeeRules|useAccountingSettings|useIncomeStatementSources|useIncomePayrollPreviews|useStatementMonths|usePayroll|useSweater)|contexts\/PartnerViewContext|lib\/firebaseClient)$/, replacement: fixture },
    { find: /^\.\/TopBar$/, replacement: fixture }, ...base.resolve.alias,
  ] }, server: { host: '127.0.0.1', port: 5208, strictPort: true } });
await server.listen(); server.printUrls();
