import type { ComputedSku, Preference } from '../../lib/types'
import { FilterX } from 'lucide-react'
import { fmt } from '../../lib/engine'
import { BudgetExcludedList } from './BudgetExcludedList'

/* ④ 因超预算被排除：把"消失的选项"显式交代，避免用户以为数据没识别到 */

export function BudgetExcludedSection({
  preference,
  budget,
  excludedItems,
}: {
  preference: Preference
  budget?: number
  excludedItems: ComputedSku[]
}) {
  if (preference !== 'budget' || typeof budget !== 'number' || excludedItems.length === 0) return null
  return (
    <section className="rounded-2xl border border-edge/60 bg-slate-500/5 p-5">
      <h3 className="text-sm font-bold tracking-tight mb-3 flex items-center gap-2">
        <FilterX className="h-4 w-4 text-slate-400" /> 因超预算未纳入比较
        <span className="text-xs font-normal text-slate-500">共 {excludedItems.length} 项</span>
      </h3>
      <p className="text-xs text-slate-500 leading-relaxed mb-3">
        以下规格总价超过你设置的预算 {fmt.yuan(budget)}，已按「预算优先」规则排除在排名之外
        （按超出金额从少到多排列）。在上方把预算调大，即可让它们重新参与比较。
      </p>
      <BudgetExcludedList items={excludedItems} budget={budget} />
    </section>
  )
}
