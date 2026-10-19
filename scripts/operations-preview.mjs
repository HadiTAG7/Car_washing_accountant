// Isolated visual harness: aliases all authentication and data boundaries.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import config from '../vite.config.js';
const fixture = fileURLToPath(new URL('./operations-preview/fixtures.jsx', import.meta.url));
const server = await createServer({ ...config, configFile: false,
  resolve: { alias: [{ find: /^\.\.\/(hooks\/useOperationsRead|lib\/operationsApi)$/, replacement: fixture },
    { find: /^\.\/TopBar$/, replacement: fixture }, ...Object.entries(config.resolve.alias).map(([find, replacement]) => ({ find, replacement }))] },
  server: { host: '127.0.0.1', port: 5202, strictPort: true } });
await server.listen(); server.printUrls();
