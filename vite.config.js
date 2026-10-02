import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  cacheDir: '.vite-cache',
  plugins: [react({ jsxImportSource: '@sweater/i18n' }), tailwindcss(), {
    name: 'sweater-local-jsx-runtime',
    configResolved(config) {
      // The React plugin explicitly includes its JSX runtime in dependency
      // optimization. Ours is application source: prebundling it duplicates
      // the language context and breaks live language updates in development.
      config.optimizeDeps.include = (config.optimizeDeps.include || [])
        .filter(id => !id.startsWith('@sweater/i18n/'));
    },
  }],
  resolve: { alias: { '@sweater/i18n': fileURLToPath(new URL('./src/i18n', import.meta.url)) } },
  optimizeDeps: { exclude: ['@sweater/i18n/jsx-runtime', '@sweater/i18n/jsx-dev-runtime'] },
  test: { setupFiles: ['./src/testSetup.js'] },
  // The DOM is opted into per file with `// @vitest-environment jsdom` — only
  // the *.form.test.jsx suites need one, because "the save is blocked" is a
  // claim about the form itself and not about a helper the form calls.
})
