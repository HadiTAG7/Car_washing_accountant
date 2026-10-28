// Synthetic Map-only browser fixture. No credentials, production or SSP access.
import { createServer } from 'vite';
import config from '../vite.config.js';
import { memoryFinanceDb } from '../server/__tests__/financeFixtures.js';
import { deductionSeed } from '../functions/test/bikerDeductionFixture.js';
import { previewBikerDeduction, saveBikerDeduction, readBikerDeduction } from '../functions/src/bikerDeductions.js';
const db = memoryFinanceDb(deductionSeed()), actor = { userId: 'admin' };
const base = await config({ mode: 'development', command: 'serve' });
const server = await createServer({ ...base, configFile: false, plugins: [...base.plugins, { name: 'isolated-biker-deduction-preview', configureServer(vite) {
  vite.middlewares.use('/__isolated-biker-deduction', async (req, res) => {
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST' || req.headers.host !== '127.0.0.1:5225') { res.statusCode = 403; res.end('{}'); return; }
    try {
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 16000) throw Error('Synthetic payload too large'); }
      const { op, input } = JSON.parse(body);
      const result = op === 'preview' ? await previewBikerDeduction(db, input, actor)
        : op === 'save' ? await saveBikerDeduction(db, { serverTimestamp: () => 'synthetic-time' }, input, actor)
          : op === 'read' ? await readBikerDeduction(db, input, actor) : op === 'list' ? [...db.rows].filter(([key]) => key.startsWith('quality_objections/')).map(([key, row]) => ({ ...row, id: key.split('/')[1] })) : null;
      if (result === null) throw Error('Unknown isolated operation'); res.end(JSON.stringify({ result }));
    } catch (error) { res.statusCode = 400; res.end(JSON.stringify({ error: error.message })); }
  });
} }], server: { host: '127.0.0.1', port: 5225, strictPort: true } });
await server.listen(); server.printUrls();
