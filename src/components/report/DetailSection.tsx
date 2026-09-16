import type { ComputedSku, SkuCluster } from '../../lib/types'
import type { FullGroupBy } from '../../lib/view-model'
import { groupComputedSkus, listPackWord } from '../../lib/view-model'
import { displayUnit } from '../../lib/engine'
import { ChevronDown, Layers, List } from 'lucide-react'
import { ClusterCard } from './ClusterCard'
import { RankGroupRows } from './RankGroupRows'

/**
 * ⑤ 明细（默认收起）：完整排名表，支持簇化简 / 全量切换与分组折叠。
 */
export function DetailSection({
  items,
  hasVariants,
  decisionUnits,
  view,
  onSwitchView,
  showDetail,
  onToggleDetail,
  groupBy,
  onSelectGroup,
  groupOptions,
  collapsed,
  onToggleGroup,
  flavorLabel,
  flavorColorMap,
}: {
  items: ComputedSku[]
  hasVariants: boolean
  decisionUnits: SkuCluster[] | null
  view: 'cluster' | 'full'
  onSwitchView: (v: 'cluster' | 'full') => void
  showDetail: boolean
  onToggleDetail: () => void
  groupBy: FullGroupBy | null
  onSelectGroup: (key: FullGroupBy | null) => void
  groupOptions: Array<{ key: FullGroupBy; label: string }>
  collapsed: Set<string>
  onToggleGroup: (key: string) => void
  flavorLabel: string
  flavorColorMap: Map<string, string>
}) {
  return (
    <section className="glass rounded-2xl p-6">
      <button
        onClick={onToggleDetail}
        className="w-full flex items-center justify-between gap-3 text-left no-print"
      >
        <span className="text-lg font-bold tracking-tight flex items-center gap-2">
          <List className="h-5 w-5 text-brand" /> 完整排名
          <span className="text-xs font-normal text-slate-500">共 {items.length} 项规格</span>
        </span>
        <span className="text-xs text-slate-500 inline-flex items-center gap-1.5 shrink-0">
          {showDetail ? '收起明细' : '查看明细'}
          <ChevronDown className={`h-4 w-4 transition-transform ${showDetail ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {showDetail && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h4 className="text-sm font-bold tracking-tight">
              {view === 'cluster' ? '决策排名（已按规格聚合）' : '全部规格'}
            </h4>
            {hasVariants && (
              <div className="flex rounded-lg border border-edge overflow-hidden text-xs">
                <button
                  onClick={() => onSwitchView('cluster')}
                  className={`px-3 py-1.5 font-medium flex items-center gap-1.5 transition-colors ${
                    view === 'cluster' ? 'bg-brand/15 text-brand' : 'text-slate-400 hover:text-brand-deep'
                  }`}
                >
                  <Layers className="h-3.5 w-3.5" /> 简化视图
                </button>
                <button
                  onClick={() => onSwitchView('full')}
                  className={`px-3 py-1.5 font-medium flex items-center gap-1.5 transition-colors ${
                    view === 'full' ? 'bg-brand/15 text-brand' : 'text-slate-400 hover:text-brand-deep'
                  }`}
                >
                  <List className="h-3.5 w-3.5" /> 全部 {items.length} 项
                </button>
              </div>
            )}
          </div>

          {view === 'cluster' && decisionUnits ? (
            <>
              <p className="text-xs text-slate-500">
                已把仅口味/颜色不同、价格结构一致的 {items.length} 个规格折叠为 {decisionUnits.length} 个决策项，
                先比价格、再在卡片内挑口味
              </p>
              {decisionUnits.map((cluster, idx) => (
                <ClusterCard key={cluster.key} cluster={cluster} idx={idx} flavorLabel={flavorLabel} />
              ))}
            </>
          ) : (
            <>
              {/* 分组折叠工具栏：仅当存在可分组维度时显示 */}
              {groupOptions.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span className="text-slate-500">分组折叠：</span>
                  {groupOptions.map((opt) => {
                    const active = groupBy === opt.key
                    return (
                      <button
                        key={opt.key}
                        onClick={() => {
                          onSelectGroup(active ? null : opt.key)
                        }}
                        className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                          active
                            ? 'bg-brand/15 text-brand border border-brand/50'
                            : 'text-slate-400 hover:text-brand-deep border border-edge'
                        }`}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                  {groupBy && (
                    <button
                      onClick={() => onSelectGroup(null)}
                      className="text-slate-500 hover:text-slate-600 ml-1"
                    >
                      取消分组
                    </button>
                  )}
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[640px]">
                  <thead>
                    <tr className="border-b border-edge text-left text-sm text-slate-500">
                      <th className="px-2 py-2 font-medium text-center">#</th>
                      <th className="px-2 py-2 font-medium">规格</th>
                      <th className="px-2 py-2 font-medium text-right">总价</th>
                      <th className="px-2 py-2 font-medium text-right">总量</th>
                      <th className="px-2 py-2 font-medium text-right">每{displayUnit(items[0]?.unit ?? '')}</th>
                      <th className="px-2 py-2 font-medium text-right">每{listPackWord(items)}</th>
                    </tr>
                  </thead>
                  {/* key 随 groupBy 变化，切换分组维度时整体重挂载 */}
                  <tbody key={groupBy ?? 'none'}>
                    {(groupBy
                      ? groupComputedSkus(items, groupBy, flavorLabel)
                      : [{ key: '__all__', items }]
                    ).map((group) => {
                      const isGrouped = groupBy !== null
                      const isCollapsed = collapsed.has(group.key)
                      return (
                        <RankGroupRows
                          key={group.key}
                          groupKey={group.key}
                          groupItems={group.items}
                          allItems={items}
                          isGrouped={isGrouped}
                          isCollapsed={isCollapsed}
                          onToggle={() => onToggleGroup(group.key)}
                          flavorColorMap={flavorColorMap}
                        />
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}
