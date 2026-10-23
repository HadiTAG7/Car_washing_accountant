// Real handlers on synthetic, in-memory data. No backend runtime, DB URL or credential.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import viteConfig from '../vite.config.js';
import { dispatch } from '../functions/src/handlers.js';
import { expensePreviewDb } from './expense-safety-preview/seed.js';
const db = expensePreviewDb(), data = fileURLToPath(new URL('./expense-safety-preview/data.jsx', import.meta.url));
const config = await viteConfig({ mode: 'development', command: 'serve' });
const allowed = new Set(['startupUpdatePlan', 'startupDeletePlan', 'annualPlanAction']);
const server = await createServer({ ...config, configFile: false,
  plugins: [...config.plugins, { name: 'isolated-expense-handler', configureServer(vite) { vite.middlewares.use('/__expense-test', async (req, res) => {
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    try {
      if (req.method !== 'POST' || req.headers.host !== '127.0.0.1:5206') throw Error('Local-only fixture');
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 40000) throw Error('Too large'); }
      const input = JSON.parse(body); if (input.name !== 'read' && !allowed.has(input.name)) throw Error('Unsupported isolated action');
      const result = input.name === 'read' ? null : await dispatch(db, { serverTimestamp: () => new Date().toISOString() }, input.name, input.data, { uid: 'local-admin' });
      const rows = {}; for (const [path, row] of db.rows) { const [collection, id] = path.split('/'); (rows[collection] ||= []).push({ ...row, id }); }
      console.log(JSON.stringify({ isolated: true, action: input.name, auditCount: rows.audit_logs?.length || 0, journals: rows.journal_entries?.length || 0 }));
      res.end(JSON.stringify({ result, rows }));
    } catch (error) { res.statusCode = 400; res.end(JSON.stringify({ error: error.message })); }
  }); } }],
  resolve: { alias: [{ find: /^\.\.\/(hooks\/(useStartupCosts|useStartupCostEntries|useAnnualExpenses|useAnnualExpenseEntries|useAnnualExpenseCategories|useTemporaryExpenses|useBikers|useWashes|useIncomePayrollPreviews|useCategories|useAccountingSettings)|contexts\/PartnerViewContext|lib\/(firebaseClient|ledgerTransport))$/, replacement: data }, { find: /^\.\/TopBar$/, replacement: data }, ...config.resolve.alias] },
  server: { host: '127.0.0.1', port: 5206, strictPort: true } });
await server.listen(); server.printUrls();
