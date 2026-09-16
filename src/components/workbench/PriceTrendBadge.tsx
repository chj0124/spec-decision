import type { PricePoint } from '../../lib/types'
import { fmt, fmtPointDay, priceTrend } from '../../lib/engine'
import { Minus, TrendingDown, TrendingUp } from 'lucide-react'

/**
 * 价格走势徽标：只有录到 ≥2 个价格点（跨天变过价）才出现，hover 可看历史明细。
 * 降价用绿色（对买家是好消息），涨价用琥珀色 —— 与报告里的涨跌语义保持一致。
 */
export function PriceTrendBadge({ history, className = '' }: { history?: PricePoint[]; className?: string }) {
  const trend = priceTrend(history)
  if (!trend) return null
  const { direction, deltaPct, points } = trend
  const flat = direction === 'flat'
  const down = direction === 'down'
  const Icon = flat ? Minus : down ? TrendingDown : TrendingUp
  const tone = flat ? 'text-slate-400' : down ? 'text-emerald-500' : 'text-amber-500'
  const label = flat ? '持平' : `${down ? '降' : '涨'}${Math.abs(deltaPct).toFixed(1)}%`
  const detail = points.map((p) => `${fmtPointDay(p.t)} ${fmt.yuan(p.price)}`).join(' → ')
  return (
    <span
      title={`价格历史（${points.length} 条）：${detail}`}
      aria-label={`价格${label}`}
      className={`inline-flex items-center gap-0.5 shrink-0 text-[10px] tabular whitespace-nowrap ${tone} ${className}`}
    >
      <Icon className="h-3 w-3 shrink-0" />
      {label}
    </span>
  )
}
