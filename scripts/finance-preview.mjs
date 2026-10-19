// Local visual harness only. It aliases every finance data/auth boundary;
// no Firebase module or live API is loaded. Never used by the production build.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import config from '../vite.config.js';
const fixture = fileURLToPath(new URL('./finance-preview/fixtures.jsx', import.meta.url));
const server = await createServer({ ...config, configFile: false,
  resolve: { alias: [{ find: /^\.\.\/(hooks\/useFinanceRead|hooks\/useLedger|contexts\/PartnerViewContext|lib\/financeApi)$/, replacement: fixture },
    { find: /^\.\/TopBar$/, replacement: fixture }, ...Object.entries(config.resolve.alias).map(([find, replacement]) => ({ find, replacement }))] },
  server: { host: '127.0.0.1', port: 5199, strictPort: true } });
await server.listen(); server.printUrls();
