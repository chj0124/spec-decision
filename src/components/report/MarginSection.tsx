import type { ComputedSku, MarginInsight } from '../../lib/types'
import { TrendingUp, ChevronDown } from 'lucide-react'
import { fmt, displayUnit, displayUnitPrice, displayQuantity, parseFlavor } from '../../lib/engine'
import { shortSpec } from '../../lib/view-model'
import { GRADE_STYLE } from './constants'
import { UpgradeCard } from './UpgradeCard'

/**
 * ③ 升档值不值：一档一张卡，把「多花多少钱、多拿多少量、净省多少」说清。
 * 内含基准档选择、升档卡片网格与可收起的逐档明细表。
 */
export function MarginSection({
  margins,
  marginBaseId,
  onMarginBaseChange,
  marginTiers,
  sectionMargins,
  showMarginTable,
  onToggleMarginTable,
}: {
  margins: MarginInsight[]
  marginBaseId: string | null
  onMarginBaseChange: (id: string | null) => void
  marginTiers: ComputedSku[]
  sectionMargins: MarginInsight[]
  showMarginTable: boolean
  onToggleMarginTable: () => void
}) {
  if (margins.length === 0) return null
  return (
    <section className="glass rounded-2xl p-6">
      <h3 className="text-lg font-bold tracking-tight mb-1 flex items-center gap-2">
        <TrendingUp className="h-5 w-5 text-brand" /> 升档值不值
      </h3>
      <p className="text-xs text-slate-500 mb-2">
        卡片「A → B」里的 <b className="text-slate-600">A 就是基准档</b>：默认按总量从小到大逐档对比，即每一档与紧挨着的更小一档比；
        <b className="text-slate-600">净省（白赚）</b> 是「这一档多拿的量，按基准档单价折算成钱，减去你多花的钱」——
        为正说明加量把多花的钱赚回来了，越大越值得升。
      </p>
      <p className="text-xs text-slate-500 mb-4">
        觉得默认基准不合心意？在下面选一个基准档，所有更大的档都会直接与它对比。
      </p>

      {/* 基准档选择：默认逐档相邻对比，也可固定某一档为基准 */}
      <div className="mb-4 flex items-center gap-2 flex-wrap text-xs no-print">
        <span className="text-slate-500">基准档：</span>
        <select
          value={marginBaseId ?? ''}
          onChange={(e) => onMarginBaseChange(e.target.value || null)}
          className="rounded-lg border border-edge bg-brand-soft/30 px-2 py-1 text-xs text-slate-600 dark:text-slate-300 max-w-full"
          title="默认逐档对比（每档 vs 前一档）；选择某一档后，所有更大的档都与它直接对比"
        >
          <option value="">逐档对比（每档 vs 前一档，默认）</option>
          {marginTiers.map((t) => (
            <option key={t.id} value={t.id}>
              {shortSpec(t.name)}（{fmt.priceUnit(displayUnitPrice(t.unitPrice, t.unit))}/{displayUnit(t.unit)}）
            </option>
          ))}
        </select>
      </div>

      {sectionMargins.length > 0 ? (
        /* 自适应网格：宽屏一行两张卡填满留白，窄屏退回单列；grid 默认拉伸，同行卡片等高 */
        <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
          {sectionMargins.map((m, i) => (
            <UpgradeCard key={`${m.fromId}-${m.toId}-${i}`} m={m} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-500 rounded-xl border border-edge bg-brand-soft/20 px-3 py-2.5">
          选中的基准档已是总量最大的一档，没有可升的档位——换一个更小的基准试试。
        </p>
      )}

      {/* 逐档明细表：结论已在卡片里，明细默认收起 */}
      <button
        onClick={onToggleMarginTable}
        className="mt-4 text-xs text-slate-500 hover:text-brand transition-colors inline-flex items-center gap-1.5 no-print"
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showMarginTable ? 'rotate-180' : ''}`} />
        {showMarginTable ? '收起逐档明细' : `展开逐档明细（${sectionMargins.length} 档）`}
      </button>

      {showMarginTable && sectionMargins.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs min-w-[520px]">
            <thead>
              <tr className="border-b border-edge text-left text-sm text-slate-500">
                <th className="px-2 py-2 font-medium">规格</th>
                <th className="px-2 py-2 font-medium text-right">多花</th>
                <th className="px-2 py-2 font-medium text-right">多得</th>
                <th className="px-2 py-2 font-medium text-right">单价变化</th>
                <th className="px-2 py-2 font-medium text-right">净省</th>
                <th className="px-2 py-2 font-medium text-right">多花1元多得</th>
              </tr>
            </thead>
            <tbody>
              {sectionMargins.map((m, i) => {
                const style = GRADE_STYLE[m.grade]
                // 拆分规格名：优先显示关键规格部分（如 16g×8袋），口味作为副标题
                const { flavor, spec } = parseFlavor(m.toName)
                const showShort = spec && spec.length <= 20
                // 多花1元能多买多少量 = 多得的量 / 多花的钱（边际效率）
                const perExtraYuan = m.extraCost > 0 ? m.extraQuantity / m.extraCost : 0
                return (
                  <tr
                    key={i}
                    className={`border-b border-edge/50 hover:bg-brand-soft/30 transition-colors ${style.row}`}
                  >
                    {/* 规格 + 评级合并：左侧 3px 色条标识分级，规格名后跟评级标签 */}
                    <td className="px-2 py-2.5" style={{ borderLeft: `3px solid ${style.bar}` }}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium truncate max-w-[180px]" title={m.toName}>
                          {showShort ? spec : m.toName}
                        </span>
                        {showShort && flavor && (
                          <span className="text-sm text-slate-500 truncate max-w-[140px]">{flavor}</span>
                        )}
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${style.badge}`}>
                          {style.label}
                        </span>
                      </div>
                      <div className="text-sm text-slate-500 mt-0.5">{m.verdict}</div>
                    </td>
                    <td className="px-2 py-2.5 text-right tabular text-brand-deep">{fmt.yuan(m.extraCost)}</td>
                    <td className="px-2 py-2.5 text-right tabular text-brand-deep">{fmt.num(displayQuantity(m.extraQuantity, m.unit))}{displayUnit(m.unit)}</td>
                    <td className={`px-2 py-2.5 text-right tabular font-semibold ${m.unitPriceDropPct > 0 ? 'text-brand' : m.unitPriceDropPct < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                      {m.unitPriceDropPct > 0 ? '-' : m.unitPriceDropPct < 0 ? '+' : ''}{Math.abs(m.unitPriceDropPct).toFixed(1)}%
                    </td>
                    <td className={`px-2 py-2.5 text-right tabular font-semibold ${m.netSaving >= 0 ? 'text-emerald-500' : 'text-amber-500'}`}>
                      {m.netSaving >= 0 ? '+' : '−'}{fmt.yuan(Math.abs(m.netSaving))}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular font-semibold text-brand">
                      {perExtraYuan > 0 ? `${fmt.num(displayQuantity(perExtraYuan, m.unit))}${displayUnit(m.unit)}` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {/* 图例 */}
          <div className="mt-3 flex flex-wrap gap-3 text-sm text-slate-500">
            {Object.entries(GRADE_STYLE).map(([k, v]) => (
              <span key={k} className="inline-flex items-center gap-1">
                <span className={`inline-block w-2.5 h-2.5 rounded-sm ${v.dot}`} />
                {v.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
