// Local read-only visual harness. No report data is committed or bundled in production.
import { createServer } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../vite.config.js';
if (!process.argv[2]?.endsWith('.json')) throw new Error('Supply the authorized reviewed report JSON path.');
const report = resolve(process.argv[2]);
const fixture = fileURLToPath(new URL('./executive-dashboard-preview/fixtures.jsx', import.meta.url));
const server = await createServer({ ...config, configFile: false,
  resolve: { alias: [{ find: '@reviewed-executive-report', replacement: report },
    { find: /^\.\.\/(hooks\/(useExecutiveReports|useAuth|usePartners)|contexts\/PartnerViewContext|lib\/firebaseClient)$/, replacement: fixture },
    { find: /^\.\/ChangePasswordModal$/, replacement: fixture }, ...Object.entries(config.resolve.alias).map(([find,replacement])=>({find,replacement}))] },
  server: { host: '127.0.0.1', port: 5203, strictPort: true, fs: { allow: [process.cwd(), dirname(report)] } } });
await server.listen(); server.printUrls();
