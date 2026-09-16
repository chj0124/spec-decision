/**
 * 全局配色单一来源。
 *
 * 历史上 `FLAVOR_COLORS`（3 处）、`GROUP_BAR_COLORS`（2 处）、`PIE_COLORS`（1 处）
 * 分散在 Workbench / Report / RecognizeReview 内重复定义，现统一收敛于此。
 * 组件一律通过本模块取色，禁止再就地定义调色板。
 */
export const palette: {
  /** 第一分组维度（口味/颜色/型号）行底色调色板：亮/暗双模式，浅色不抢阅读 */
  flavor: string[]
  /** 参数维度列分组色条颜色（纯色值，用于 inline style 左侧色条） */
  groupBar: string[]
  /** 权重饼图调色板（价格 + 各维度，与图表主题一致的靛蓝主色系） */
  pie: string[]
} = {
  flavor: [
    'bg-sky-100/60 dark:bg-sky-900/20',
    'bg-amber-100/60 dark:bg-amber-900/20',
    'bg-emerald-100/60 dark:bg-emerald-900/20',
    'bg-violet-100/60 dark:bg-violet-900/20',
    'bg-rose-100/60 dark:bg-rose-900/20',
    'bg-cyan-100/60 dark:bg-cyan-900/20',
    'bg-orange-100/60 dark:bg-orange-900/20',
    'bg-teal-100/60 dark:bg-teal-900/20',
  ],
  groupBar: [
    '#0ea5e9', '#f59e0b', '#10b981', '#a855f7',
    '#f43f5e', '#06b6d4', '#f97316', '#14b8a6',
  ],
  pie: ['#4f46e5', '#f59e0b', '#10b981', '#a855f7', '#ef4444', '#0ea5e9', '#ec4899'],
}
