import type { PricePoint } from '../../lib/types'
import { fmt, isStale } from '../../lib/engine'
import { AlertCircle } from 'lucide-react'

/**
 * 价格新鲜度：把"这条价格是什么时候录的"摆到行上。
 * 价格点的时间戳此前只写不读，数据看着永远新鲜；超过 STALE_DAYS 未更新时标琥珀色 + 警示图标，
 * 让"结论可能过期"变得可见。
 */
export function PriceAgeBadge({ history, className = '' }: { history?: PricePoint[]; className?: string }) {
  const last = history?.[history.length - 1]
  if (!last) return null
  const stale = isStale(last.t)
  return (
    <span
      title={`价格记录于 ${new Date(last.t).toLocaleString('zh-CN')}`}
      className={`inline-flex items-center gap-0.5 shrink-0 text-[10px] tabular whitespace-nowrap ${
        stale ? 'text-amber-500 font-medium' : 'text-slate-400'
      } ${className}`}
    >
      {stale && <AlertCircle className="h-3 w-3 shrink-0" />}
      {fmt.ago(last.t)}
    </span>
  )
}
