import type { ComputedSku } from '../../lib/types'
import { fmt } from '../../lib/engine'

/**
 * 因超预算被排除的规格清单：逐条列出规格名、总价与超出预算的金额。
 * 预算偏好会把超预算的规格从排名里过滤掉，如果不显式交代，它们就等于无声消失，
 * 用户无从判断"是数据没识别到"还是"被预算规则筛掉了"。
 */
export function BudgetExcludedList({ items, budget }: { items: ComputedSku[]; budget: number }) {
  return (
    <ul aria-label="因超预算被排除的规格" className="space-y-1.5">
      {items.map((it) => (
        <li key={it.id} className="flex items-baseline justify-between gap-3 text-xs">
          <span className="text-slate-600 truncate">{it.name}</span>
          <span className="shrink-0 tabular">
            <span className="text-slate-500">{fmt.yuan(it.price)}</span>
            <span className="text-amber-500 ml-1.5">超 {fmt.yuan(it.price - budget)}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}
