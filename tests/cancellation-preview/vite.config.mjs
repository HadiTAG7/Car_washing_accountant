import { defineConfig, mergeConfig } from 'vite';
import base from '../../vite.config.js';
export default defineConfig(env => mergeConfig(base(env), {
  plugins: [{ name: 'isolated-cancellation-preview', enforce: 'pre', load(id) {
    const path = id.replaceAll('\\', '/').split('?')[0];
    if (path.endsWith('/src/hooks/useSweaterBookingSource.js')) return 'export { useSweaterBookingSource } from "/tests/cancellation-preview/source.js";';
    if (path.endsWith('/src/hooks/useBikers.js')) return 'export const useBikers = () => ({ bikers: [{ driverExternalId: "TEST-1986", name: "بايكر تجريبي", nameEnglish: "Test biker" }], error: null });';
  } }],
  server: { host: '127.0.0.1', port: 5214, strictPort: true },
}));
