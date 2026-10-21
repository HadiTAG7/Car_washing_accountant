import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import process from 'node:process'
import { staticAssetsPlugin } from './scripts/static-assets-plugin.mjs'

// Public release identifier only, not environment contents or a credential.
function releaseId() {
  const deployed = process.env.VERCEL_GIT_COMMIT_SHA || '';
  if (/^[a-f0-9]{40}$/i.test(deployed)) return deployed.toLowerCase();
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(new URL('.', import.meta.url)), encoding: 'utf8' }).trim(); }
  catch { return 'unknown'; }
}

// `--mode emulator`: count Firestore reads in the browser and send `/api` to
// the local API server over the emulators (scripts/emulator/). Never in a
// real build — those run in production mode.
const emulatorMode = mode => mode === 'emulator' ? {
  alias: [{ find: /^firebase\/firestore$/, replacement: fileURLToPath(new URL('./scripts/emulator/firestore-meter.js', import.meta.url)) }],
  proxy: { '/api': { target: `http://127.0.0.1:${process.env.API_PORT || 5174}`, changeOrigin: false } },
} : null;

export default defineConfig(({ mode }) => ({
  cacheDir: '.vite-cache',
  plugins: [staticAssetsPlugin(releaseId()), { name: 'sweater-diagnostic-release', transformIndexHtml() { return [{ tag: 'meta', attrs: { name: 'sw-build', content: releaseId() }, injectTo: 'head' }]; } }, react({ jsxImportSource: '@sweater/i18n' }), tailwindcss(), {
    name: 'sweater-local-jsx-runtime',
    configResolved(config) {
      // The React plugin explicitly includes its JSX runtime in dependency
      // optimization. Ours is application source: prebundling it duplicates
      // the language context and breaks live language updates in development.
      config.optimizeDeps.include = (config.optimizeDeps.include || [])
        .filter(id => !id.startsWith('@sweater/i18n/'));
    },
  }],
  resolve: { alias: [
    { find: '@sweater/i18n', replacement: fileURLToPath(new URL('./src/i18n', import.meta.url)) },
    ...(emulatorMode(mode)?.alias || []),
  ] },
  ...(emulatorMode(mode) ? { server: { proxy: emulatorMode(mode).proxy }, preview: { proxy: emulatorMode(mode).proxy } } : {}),
  optimizeDeps: { exclude: ['@sweater/i18n/jsx-runtime', '@sweater/i18n/jsx-dev-runtime'] },
  test: { setupFiles: ['./src/testSetup.js'] },
  // The DOM is opted into per file with `// @vitest-environment jsdom` — only
  // the *.form.test.jsx suites need one, because "the save is blocked" is a
  // claim about the form itself and not about a helper the form calls.
}))
