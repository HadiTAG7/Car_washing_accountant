import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'functions/node_modules', 'mcp/node_modules']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': [
        'error',
        { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^[A-Z_]' },
      ],
    },
  },
  // The trusted server runs under Node with the Admin SDK, not in a browser.
  {
    // ما يعمل على Node لا في المتصفّح: الخادم الموثوق بمنفذَيه (Cloud
    // Functions و`api/`)، وخادم MCP.
    files: ['functions/**/*.js', 'mcp/**/*.js', 'api/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  // Test files execute under Node (vitest), so they legitimately touch
  // `process` and the vitest globals.
  {
    files: ['**/__tests__/**/*.js', '**/*.test.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
])
