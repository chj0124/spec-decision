import { defineConfig } from 'vitest/config'

// 独立于 vite.config.ts：单元测试只跑纯逻辑模块（engine/spec/units/scoring 等），
// 不需要 React 插件与 dev 期的 AI 代理中间件，避免测试环境被无关插件污染。
export default defineConfig({
  test: {
    environment: 'node',
    // shared/ 放的是三端部署共用的纯 JS（AI 代理核心），同样按纯逻辑测试。
    // api/ 放的是 Serverless handler（Web 标准 Request/Response），Node 环境可直接跑。
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'shared/**/*.{test,spec}.js',
      'api/**/*.{test,spec}.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      // 只统计纯逻辑层（.ts）：UI 组件（.tsx）依赖 DOM，不在 node 单测范围内，
      // 计入分母只会把阈值稀释成无意义的数字。
      include: ['src/**/*.ts', 'shared/**/*.js', 'api/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.test.js',
        '**/*.d.ts',
        'src/vite-env.d.ts',
        '**/types.ts',
      ],
      // 阈值门禁：低于此线即让测试失败，防止覆盖率悄悄劣化。
      // 数值取当前实测（约 60/80/80/60）下方的安全水位，给跨 Node 版本的 v8 统计留余量。
      thresholds: {
        statements: 50,
        branches: 60,
        functions: 60,
        lines: 50,
      },
    },
  },
})
