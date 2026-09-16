import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  {
    // JS 侧同样纳入 lint：_worker.js、api/*.js、shared/aiProxyCore.js、e2e/*.mjs
    // 这些是真正跑在服务端/CI 的代码，之前完全在规则覆盖之外。
    files: ['**/*.{js,mjs,cjs}'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        // Cloudflare Worker / public/sw.js 的 self、caches、fetch 等
        ...globals.serviceworker,
      },
    },
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // AI 上游（OpenAI 兼容接口 / 视觉模型）返回的是无 schema 的 JSON，
      // 在解析边界保留 any 并降级为 warn：为上游响应造精确类型收益低、且易随上游漂移。
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
)
