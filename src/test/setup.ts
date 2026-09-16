import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// 组件测试跑在 jsdom 下，纯逻辑测试仍跑在 node 下；同一份 setup 会被两者加载，
// 因此所有 DOM 相关操作都要先判断环境存在性，否则 node 侧会直接报错。

// jsdom 未实现、但组件真实依赖的浏览器 API：只补「缺失即抛错」的最小替身，
// 不模拟行为细节——否则用例会断言到假象而非组件真实行为。
if (typeof window !== 'undefined') {
  // App 底部渲染构建期注入的版本号（vite define）。只在 jsdom（组件测试）里补上，
  // 绝不放进 vitest 全局 define —— 否则 node 侧的逻辑测试也会被替换，
  // telemetry 的「无构建期常量 → 降级 dev」这条用例就永远为真、失去意义。
  ;(globalThis as unknown as { __APP_VERSION__: string }).__APP_VERSION__ = 'test'

  // Report 读取 prefers-reduced-motion 决定是否播放动画
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  }

  // Recharts 的 ResponsiveContainer 依赖 ResizeObserver 才能量出容器宽度
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }

  if (!URL.createObjectURL) {
    URL.createObjectURL = () => 'blob:vitest'
    URL.revokeObjectURL = () => {}
  }

  // jsdom 未实现滚动，framer-motion 的 layout 动画会触发它并往 stderr 刷噪音
  window.scrollTo = () => {}

  // 剪贴板：默认写入成功，便于断言「已复制」反馈；单个用例可覆盖实现来验证失败分支
  if (!navigator.clipboard) {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(async () => {}) },
      configurable: true,
    })
  }
}

afterEach(() => {
  // globals 未开启，Testing Library 不会自动注册清理，这里显式收尾
  if (typeof document !== 'undefined') cleanup()
  // 用例之间隔离本地存储：组件与 store 都以它为单一数据源，残留会串味
  if (typeof localStorage !== 'undefined') localStorage.clear()
})
