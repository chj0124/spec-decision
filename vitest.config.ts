import { defineConfig } from 'vitest/config'

// 独立于 vite.config.ts：单元测试只跑纯逻辑模块（engine/spec/units/scoring 等），
// 不需要 React 插件与 dev 期的 AI 代理中间件，避免测试环境被无关插件污染。
export default defineConfig({
  test: {
    environment: 'node',
    // shared/ 放的是三端部署共用的纯 JS（AI 代理核心），同样按纯逻辑测试。
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'shared/**/*.{test,spec}.js'],
  },
})
