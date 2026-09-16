import type { MarginInsight } from '../../lib/types'
import { fmt, displayUnit, displayQuantity } from '../../lib/engine'
import { shortSpec } from '../../lib/view-model'
import { GRADE_STYLE } from './constants'

/** 升档卡片：多花 / 多得 / 每单位变化 + 最醒目的「净省」金额 */
export function UpgradeCard({ m }: { m: MarginInsight }) {
  const style = GRADE_STYLE[m.grade]
  const unitLabel = displayUnit(m.unit)
  const pct = m.unitPriceDropPct
  return (
    <div
      className={`rounded-2xl border border-edge p-4 ${style.row}`}
      style={{ borderLeft: `3px solid ${style.bar}` }}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <span className="text-slate-500 truncate max-w-[150px]" title={m.fromName}>{shortSpec(m.fromName)}</span>
            <span className="text-slate-400">→</span>
            <span className="font-semibold truncate max-w-[180px]" title={m.toName}>{shortSpec(m.toName)}</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${style.badge}`}>{style.label}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
            <span>多花 <b className="tabular text-slate-600">{fmt.yuan(m.extraCost)}</b></span>
            <span>多得 <b className="tabular text-slate-600">{fmt.num(displayQuantity(m.extraQuantity, m.unit))}{unitLabel}</b></span>
            <span>
              每{unitLabel}
              <b className={`tabular ml-1 ${pct > 0 ? 'text-emerald-500' : pct < 0 ? 'text-amber-500' : 'text-slate-500'}`}>
                {pct > 0 ? `便宜 ${pct.toFixed(1)}%` : pct < 0 ? `反贵 ${Math.abs(pct).toFixed(1)}%` : '持平'}
              </b>
            </span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs text-slate-500">{m.netSaving >= 0 ? '净省（白赚）' : '净多花'}</div>
          <div className={`text-2xl font-bold tabular ${m.netSaving >= 0 ? 'text-emerald-500' : 'text-amber-500'}`}>
            {fmt.yuan(Math.abs(m.netSaving))}
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-400 leading-relaxed">{m.verdict}</p>
    </div>
  )
}
