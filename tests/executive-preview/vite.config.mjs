import { defineConfig, mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import base from '../../vite.config.js';
export default defineConfig(env => mergeConfig(base(env), {
  appType: 'mpa',
  plugins: [{ name: 'isolated-executive-visual-fixture', enforce: 'pre', load(id) {
    const path = id.replaceAll('\\', '/').split('?')[0];
    if (['useExecutiveDailyMetrics', 'useLatestOperationsReview', 'useExecutiveQualityReview'].some(name => path.endsWith(`/src/hooks/${name}.js`))) {
      const name = path.split('/').at(-1).slice(0, -3); return `export const ${name} = () => undefined;`;
    }
  } }],
  server: { host: '127.0.0.1', port: 5209, strictPort: true },
  build: { outDir: '.test-runtime/executive-preview', rolldownOptions: { input: fileURLToPath(new URL('./index.html', import.meta.url)) } },
}));
