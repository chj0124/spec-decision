import { useMemo, useSyncExternalStore } from 'react'

function subscribe(cb: () => void) {
  const mo = new MutationObserver(cb)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => mo.disconnect()
}

const getSnapshot = (): 'light' | 'dark' =>
  document.documentElement.classList.contains('dark') ? 'dark' : 'light'

/** 响应式读取当前亮 / 暗主题（监听 <html> class 变化） */
export function useThemeMode(): 'light' | 'dark' {
  return useSyncExternalStore(subscribe, getSnapshot, () => 'light' as const)
}

export interface ChartTheme {
  dark: boolean
  /** 主系列色：单价柱（靛蓝）/ 边际成本柱（琥珀）/ 降幅线（翠绿） */
  series: { unitPrice: string; margin: string; drop: string }
  /** 雷达图多系列调色板 */
  radar: string[]
  /** 坐标网格线 / 刻度文字 */
  grid: string
  tick: string
  /** 柱顶数值标签：填充色 + 描边底色（paintOrder=stroke 保证可读） */
  label: { fill: string; stroke: string }
  /** Recharts Tooltip contentStyle / labelStyle / itemStyle */
  tooltipStyle: React.CSSProperties
  tooltipLabelStyle: React.CSSProperties
  tooltipItemStyle: React.CSSProperties
  /** Tooltip 悬停行底色 */
  cursorFill: string
}

/** 图表主题：所有 Recharts 颜色统一从这里取，亮 / 暗自动适配 */
export function useChartTheme(): ChartTheme {
  const dark = useThemeMode() === 'dark'
  // 只有主题真正翻转时才重建：否则每次渲染都返回新对象，
  // 会让以 theme 为依赖 / props 的图表子组件无谓重渲染（父组件 state 一变就全量刷新）。
  return useMemo<ChartTheme>(() => {
    const text = dark ? '#e2e8f0' : '#334155'
    return {
      dark,
      series: {
        unitPrice: dark ? '#818cf8' : '#4f46e5',
        margin: dark ? '#fbbf24' : '#f59e0b',
        drop: dark ? '#34d399' : '#10b981',
      },
      radar: dark
        ? ['#818cf8', '#fbbf24', '#34d399', '#c084fc', '#f87171']
        : ['#4f46e5', '#f59e0b', '#10b981', '#a855f7', '#ef4444'],
      grid: dark ? '#2f2f3a' : '#e6e1d5',
      tick: dark ? '#8b8b98' : '#78716c',
      label: dark
        ? { fill: '#e2e8f0', stroke: '#16161b' }
        : { fill: '#3730a3', stroke: '#f6f5f0' },
      tooltipStyle: {
        backgroundColor: dark ? '#1c1c22' : '#ffffff',
        border: `1px solid ${dark ? '#2f2f3a' : '#e6e1d5'}`,
        borderRadius: '10px',
        fontSize: '12px',
        color: text,
        boxShadow: dark
          ? '0 8px 30px rgba(0,0,0,0.4)'
          : '0 8px 30px rgba(22,22,27,0.10)',
      },
      tooltipLabelStyle: { color: text, marginBottom: '4px' },
      tooltipItemStyle: { color: text },
      cursorFill: dark ? 'rgba(129, 140, 248, 0.10)' : 'rgba(79, 70, 229, 0.06)',
    }
  }, [dark])
}
