// Local-only browser flow with the real workbench handler and synthetic memory
// data. No backend runtime, credentials, production database, or remote writes.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import config from '../vite.config.js';
import { financeWorkbench } from '../server/financeWorkbench.js';
import { memoryFinanceDb, expensePatch } from '../server/__tests__/financeFixtures.js';
const db = memoryFinanceDb({ 'users/test-admin': { role: 'admin' }, 'variable_expense_categories/test-category': { name: 'تصنيف اختبار' },
  'app_settings/accounting': { value: { vatRegistered: false } }, 'chart_of_accounts/5100': {}, 'chart_of_accounts/2000': {}, 'chart_of_accounts/1010': {} });
for (let index = 1; index <= 3; index++) {
  const request = { kind: 'variable', requestId: `BROWSER-${index}`, patch: expensePatch({ description: `مستند اختبار ${index}`, amount: index * 100,
    invoiceNumber: `BROWSER-${index}`, invoiceUrl: `https://example.org/test-only-${index}` }) };
  const preview = await financeWorkbench(db, { uid: 'test-admin' }, { action: 'previewCapture', ...request });
  await financeWorkbench(db, { uid: 'test-admin' }, { action: 'capture', ...request, previewHash: preview.previewHash, reason: 'تهيئة اختبار اصطناعي فقط', confirm: true });
}
db.rows.set('variable_expenses/incomplete-only', { expense_name: 'تحويل بنكي قديم — اختبار نقد متناقض', total_variable_cost: 50, logged_date: '2026-05-01', payment_method: 'cash' });
const fixture = fileURLToPath(new URL('./finance-preview/fixtures.jsx', import.meta.url)), flow = fileURLToPath(new URL('./finance-preview/workbench-flow.jsx', import.meta.url));
const resolved = typeof config === 'function' ? await config({ mode: 'development', command: 'serve' }) : config;
const server = await createServer({ ...resolved, configFile: false,
  plugins: [...resolved.plugins, { name: 'isolated-workbench-handler', configureServer(vite) {
    vite.middlewares.use('/__finance-workbench-test', async (req, res) => {
      res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
      if (req.method !== 'POST' || req.headers.host !== '127.0.0.1:5204') { res.statusCode = 403; res.end('{}'); return; }
      try {
        let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 64000) throw new Error('Too large'); }
        const request = JSON.parse(body), result = await financeWorkbench(db, { uid: 'test-admin' }, request);
        console.log(JSON.stringify({ isolated: true, action: request.action, journals: [...db.rows.keys()].filter(key => key.startsWith('journal_entries/')).length }));
        res.end(JSON.stringify({ result }));
      } catch (error) { res.statusCode = 400; res.end(JSON.stringify({ error: error.message })); }
    });
  } }],
  resolve: { alias: [{ find: /^\.\.\/(hooks\/useFinanceRead|lib\/financeApi)$/, replacement: flow },
    { find: /^\.\.\/(hooks\/(useLedger|useOverviewDashboard|useFinanceHomeData)|contexts\/PartnerViewContext|lib\/firebaseClient)$/, replacement: fixture },
    { find: /^\.\/(TopBar|ChangePasswordModal)$/, replacement: fixture }, ...resolved.resolve.alias] },
  server: { host: '127.0.0.1', port: 5204, strictPort: true } });
await server.listen(); server.printUrls();
