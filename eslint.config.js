import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // `work/` contains independent Git worktrees and their built bundles. They
  // have their own source/lint lifecycle and must not be linted as part of the
  // active checkout (the same reason generated `dist/` is excluded).
  globalIgnores(['dist', '.vercel', 'functions/node_modules', 'mcp/node_modules', 'work']),
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
    plugins: { react },
    rules: {
      'no-unused-vars': [
        'error',
        { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^[A-Z_]' },
      ],
      // ── الأيقونة غير المستورَدة تمرّ من كل شيء إلا المتصفّح ──
      // `<Home/>` بلا `import` شحنت خضراء: `no-undef` لا يفحص `JSXIdentifier`
      // — لذلك وُجد هذا القواعد أصلاً — و esbuild لا يفحص شيئاً. النتيجة كانت
      // ReferenceError في الصفحة الوحيدة التي فُتحت، فبقيت شاشة بيضاء عند
      // المستخدم حتى أبلغ عنها. القاعدة هنا هي التي تجعل ذلك مستحيلاً.
      'react/jsx-no-undef': 'error',
    },
  },
  // Trusted Firebase and Vercel server code runs under Node with the Admin SDK,
  // not in a browser.
  {
    // ما يعمل على Node لا في المتصفّح: الخادم الموثوق بمنفذَيه (Cloud
    // Functions و`api/`)، وخادم MCP ووحدات Vercel المشتركة.
    files: ['functions/**/*.js', 'mcp/**/*.js', 'api/**/*.js', 'server/**/*.js'],
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
