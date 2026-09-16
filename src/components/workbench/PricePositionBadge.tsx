import type { PricePoint } from '../../lib/types'
import { fmt, fmtPointDay, hitsTargetPrice, priceStats } from '../../lib/engine'
import { ArrowDown, ArrowUp, Minus, Target } from 'lucide-react'

/**
 * 价格位置徽标：把"现在这个价，在历史里算什么位置"摆到行上。
 *  - 用户显式设了目标价且到手价达标 → 优先提示"已达目标价"（这是用户自己的意图，信号最强）
 *  - 否则在留下 ≥2 条价格记录时，给出「历史最低 / 低于均价 / 高于均价」
 * 降价语义用绿色（对买家是好消息），涨价用琥珀色，与 PriceTrendBadge 保持一致。
 */
export function PricePositionBadge({
  history,
  targetPrice,
  className = '',
}: {
  history?: PricePoint[]
  targetPrice?: number
  className?: string
}) {
  const stats = priceStats(history)
  if (!stats) return null

  if (hitsTargetPrice({ price: stats.current, targetPrice })) {
    const target = Number(targetPrice)
    return (
      <span
        title={`到手价 ${fmt.yuan(stats.current)} 已达目标价 ${fmt.yuan(target)}`}
        aria-label="已达目标价"
        className={`inline-flex items-center gap-0.5 shrink-0 text-[10px] tabular whitespace-nowrap text-emerald-500 font-medium ${className}`}
      >
        <Target className="h-3 w-3 shrink-0" />
        已达目标价
      </span>
    )
  }

  // 只有一条记录时"历史最低/均价"就是它自己，说了等于没说 —— 不渲染
  if (stats.points.length < 2) return null

  const { isLowest, vsAvgPct, percentile } = stats
  const Icon = isLowest || vsAvgPct < 0 ? ArrowDown : vsAvgPct > 0 ? ArrowUp : Minus
  const tone = isLowest || vsAvgPct < 0 ? 'text-emerald-500' : vsAvgPct > 0 ? 'text-amber-500' : 'text-slate-400'
  const label = isLowest
    ? '历史最低'
    : vsAvgPct === 0
      ? '与均价持平'
      : `${vsAvgPct > 0 ? '高于' : '低于'}均价 ${Math.abs(vsAvgPct).toFixed(1)}%`
  const detail = `${stats.points.length} 条记录：最低 ${fmt.yuan(stats.min)} · 均价 ${fmt.yuan(stats.avg)} · 最高 ${fmt.yuan(stats.max)}（${fmtPointDay(stats.points[0].t)} 起）`

  return (
    <span
      title={`价格位置（${detail}）；当前价比 ${percentile}% 的历史记录更便宜`}
      aria-label={`价格位置 ${label}`}
      className={`inline-flex items-center gap-0.5 shrink-0 text-[10px] tabular whitespace-nowrap ${tone} ${className}`}
    >
      <Icon className="h-3 w-3 shrink-0" />
      {label}
    </span>
  )
}
