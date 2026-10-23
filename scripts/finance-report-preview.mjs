// Test-only local read path: real report service + isolated synthetic memory.
// Never imports the backend runtime or a production credential.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import config from '../vite.config.js';
import { financeReports } from '../server/financeReports.js';
import { financeReportViewDb } from '../server/__tests__/financeReportViewFixture.js';
const db = financeReportViewDb(), original = JSON.stringify([...db.rows]);
const fixture = fileURLToPath(new URL('./finance-preview/fixtures.jsx', import.meta.url));
const data = fileURLToPath(new URL('./finance-report-preview/data.jsx', import.meta.url));
const resolved = typeof config === 'function' ? await config({ mode: 'development', command: 'serve' }) : config;
const server = await createServer({ ...resolved, configFile: false,
  plugins: [...resolved.plugins, { name: 'isolated-finance-report-handler', configureServer(vite) {
    vite.middlewares.use('/__finance-report-test', async (req, res) => {
      res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
      try {
        if (req.method !== 'POST' || req.headers.host !== '127.0.0.1:5205') throw new Error('Local-only read endpoint');
        let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 64000) throw new Error('Too large'); }
        const input = JSON.parse(body); if (!['archive', 'read', 'forExecutive'].includes(input.action)) throw new Error('Read-only test');
        const result = await financeReports(db, { uid: 'test-admin' }, input);
        if (original !== JSON.stringify([...db.rows])) throw new Error('Read path mutated test data');
        console.log(JSON.stringify({ isolated: true, action: input.action, unchanged: true }));
        res.end(JSON.stringify({ result }));
      } catch (error) { res.statusCode = 400; res.end(JSON.stringify({ error: error.message })); }
    });
  } }],
  resolve: { alias: [{ find: /^\.\.\/(hooks\/(useFinanceRead|useExecutiveDailyMetrics)|lib\/financeApi)$/, replacement: data },
    { find: /^\.\.\/(hooks\/(useLedger|useOverviewDashboard|useFinanceHomeData)|contexts\/PartnerViewContext|lib\/firebaseClient)$/, replacement: fixture },
    { find: /^\.\/(TopBar|ChangePasswordModal)$/, replacement: fixture }, ...resolved.resolve.alias] },
  server: { host: '127.0.0.1', port: 5205, strictPort: true } });
await server.listen(); server.printUrls();
