import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: { setupFiles: ['./src/testSetup.js'] },
  // The DOM is opted into per file with `// @vitest-environment jsdom` — only
  // the *.form.test.jsx suites need one, because "the save is blocked" is a
  // claim about the form itself and not about a helper the form calls.
})
