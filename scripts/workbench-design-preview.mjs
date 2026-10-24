// No live backend: all auth/data seams below use synthetic read-only fixtures.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { readdir, readFile } from 'node:fs/promises';
import config from '../vite.config.js';
const base = await config({ mode: 'development', command: 'serve' });
const fixture = fileURLToPath(new URL('./workbench-design-preview/data.jsx', import.meta.url));
const server = await createServer({ ...base, configFile: false,
  plugins: [...base.plugins, { name: 'built-workbench-css-order-regression', configureServer(vite) {
    vite.middlewares.use('/__built-workbench-css', async (_req, res) => {
      try {
        const folder = fileURLToPath(new URL('../dist/assets/', import.meta.url));
        const names = await readdir(folder);
        // Reproduce production's adverse order: shared CSS AFTER page CSS.
        const ordered = ['FinanceWorkbenchPage-', 'FinanceWorkspace-'].map(prefix => names.find(name => name.startsWith(prefix) && name.endsWith('.css')));
        if (ordered.some(name => !name)) throw new Error('Run npm run build first');
        res.setHeader('Content-Type', 'text/css'); res.setHeader('Cache-Control', 'no-store');
        res.end((await Promise.all(ordered.map(name => readFile(`${folder}/${name}`, 'utf8')))).join('\n'));
      } catch { res.statusCode = 503; res.end('/* Run npm run build before testing built CSS */'); }
    });
  } }], resolve: { alias: [
  { find: /^\.\.\/(hooks\/(useAuth|useFinanceRead)|lib\/(financeApi|firebaseClient))$/, replacement: fixture },
  { find: /^\.\/(AdminPartnerSelector|ChangePasswordModal)$/, replacement: fixture }, ...base.resolve.alias,
] }, server: { host: '127.0.0.1', port: 5241, strictPort: true } });
await server.listen(); server.printUrls();
