// Synthetic read-only visual harness; the quality read and role seams are local.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import config from '../vite.config.js';
const base = await config({ mode: 'development', command: 'serve' });
const fixture = fileURLToPath(new URL('./overview-quality-preview/data.js', import.meta.url));
const server = await createServer({ ...base, configFile: false, resolve: { alias: [
  { find: /^\.\.\/(hooks\/useOverviewBikerQuality|contexts\/PartnerViewContext)$/, replacement: fixture }, ...base.resolve.alias,
] }, server: { host: '127.0.0.1', port: 5231, strictPort: true } });
await server.listen(); server.printUrls();
