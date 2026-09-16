import type { ComputedSku } from '../../lib/types'
import { fmt } from '../../lib/engine'
import { Scale, ArrowLeft } from 'lucide-react'
import { BudgetExcludedList } from './BudgetExcludedList'

/**
 * 空态正文块：区分「真没数据」与「预算偏好下全部规格超预算被过滤」。
 * 工具条与预算输入框在其上方始终挂载，用户把预算调大即可自愈。
 */
export function EmptyState({
  budgetEmpty,
  budget,
  excludedItems,
  onBack,
}: {
  budgetEmpty: boolean
  budget?: number
  excludedItems: ComputedSku[]
  onBack: () => void
}) {
  return (
    <div className="glass rounded-2xl p-12 text-center space-y-4">
      <Scale className="h-12 w-12 mx-auto text-slate-600" />
      {budgetEmpty ? (
        <>
          <p className="text-slate-400">
            预算 <span className="text-brand font-semibold">{fmt.yuan(budget ?? 0)}</span> 内没有可用规格
            （{excludedItems.length} 个规格全部超出预算）。
          </p>
          {/* 空态也要交代"被排除了哪些"，否则用户只知道数量、不知道是谁 */}
          {typeof budget === 'number' && (
            <div className="max-w-sm mx-auto text-left rounded-xl border border-edge/60 px-3 py-2.5">
              <BudgetExcludedList items={excludedItems} budget={budget} />
            </div>
          )}
          <p className="text-sm text-slate-500 -mt-2">
            在上方把预算调大，或切换为「性价比优先 / 综合得分优先」即可继续看报告。
          </p>
        </>
      ) : (
        <p className="text-slate-400">还没有可对比的规格，先回工作台填写。</p>
      )}
      <button
        onClick={onBack}
        className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-500 border border-edge hover:text-brand-deep hover:border-brand/40 transition-all inline-flex items-center gap-2"
      >
        <ArrowLeft className="h-4 w-4" /> {budgetEmpty ? '返回调整' : '返回工作台'}
      </button>
    </div>
  )
}
