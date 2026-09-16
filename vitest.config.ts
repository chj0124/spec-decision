import { defineConfig } from 'vitest/config'

// 独立于 vite.config.ts：不加载 dev 期的 AI 代理中间件，避免测试环境被无关插件污染。
// B3 起新增组件测试（.tsx）：需要真实 DOM，因此引入 jsdom。
// 这里刻意不放 @vitejs/plugin-react：vite 的 esbuild 默认就走 automatic JSX 运行时，
// 组件测试已实测无插件通过；而 vitest 2.x 自带一份 vite 5（根项目是 vite 6），
// 插件类型来自根 vite，混进来只会让 defineConfig 报「Plugin 类型不兼容」。
export default defineConfig({
  test: {
    // 纯逻辑（engine/scoring/store…）仍跑 node：它们自带 localStorage 替身、不依赖 DOM，
    // 放进 jsdom 只会平白变慢。
    environment: 'node',
    // 组件测试必须真实 DOM：按 .tsx 后缀切到 jsdom，.ts 逻辑测试保持 node。
    environmentMatchGlobs: [['src/**/*.test.tsx', 'jsdom']],
    setupFiles: ['./src/test/setup.ts'],
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
      // B3 起 UI 组件纳入统计口径：组件测试存在的意义就是让它们也被门禁看着
      include: ['src/**/*.ts', 'src/**/*.tsx', 'shared/**/*.js', 'api/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.test.js',
        '**/*.d.ts',
        'src/vite-env.d.ts',
        '**/types.ts',
      ],
      // 阈值门禁：低于此线即让测试失败，防止覆盖率悄悄劣化。
      thresholds: {
        // 逻辑层维持 B3 之前的水位（当时实测约 60/80/80/60），
        // 用分组阈值把它钉住，避免新增 UI 文件后整体百分比被稀释成无意义的数字。
        'src/lib/**': { statements: 50, branches: 60, functions: 60, lines: 50 },
        'shared/**': { statements: 50, branches: 60, functions: 60, lines: 50 },
        'api/**': { statements: 50, branches: 60, functions: 60, lines: 50 },
        // UI 层：B3 只覆盖 5 条关键交互，水位取「已覆盖路径不退化」的实测值，
        // 不追求全量 UI 覆盖（那需要几十个用例，与本次目标不成比例）。
        'src/components/**': { statements: 20, branches: 40, functions: 20, lines: 20 },
        // 全局兜底：含 App.tsx 等未单独分组的文件
        statements: 30,
        branches: 40,
        functions: 30,
        lines: 30,
      },
    },
  },
})
