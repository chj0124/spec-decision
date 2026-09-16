import type { RefObject } from 'react'
import type { Sku, ParamDim, ParamValue } from '../../lib/types'
import type { GroupBy } from '../../lib/engine'
import { groupSkus, parseFlavor } from '../../lib/engine'
import { ChevronDown, Plus } from 'lucide-react'
import { TH_BASE } from './constants'
import { GroupRows } from './GroupRows'
import { SkuRowCard } from './SkuRowCard'
import { EmptyState } from './EmptyState'

export interface SkusSectionProps {
  skus: Sku[]
  dims: ParamDim[]
  flavorLabel: string
  groupBy: GroupBy | null
  onSetGroupBy: (g: GroupBy | null) => void
  collapsed: Set<string>
  onSetCollapsed: (c: Set<string>) => void
  onToggleGroup: (key: string) => void
  update: (id: string, patch: Partial<Sku>) => void
  updateParam: (id: string, dimId: string, value: ParamValue) => void
  remove: (id: string) => void
  duplicate: (id: string) => void
  add: () => void
  tableRef: RefObject<HTMLTableElement>
  onTableKey: (e: React.KeyboardEvent<HTMLTableElement>) => void
  flavorColorMap: Map<string, string>
  dimColorMaps: Map<string, string>[]
  dimHasGroup: boolean[]
  hasAnyFlavor: boolean
  genLoading: boolean
  onGenExample: () => void
  onPickImage: () => void
  onQuickEntry: () => void
}

/** SKU 表格：拆口味列 + 可按 口味/重量/数量 分组折叠；无数据时显示快速入门 */
export function SkusSection({
  skus,
  dims,
  flavorLabel,
  groupBy,
  onSetGroupBy,
  collapsed,
  onSetCollapsed,
  onToggleGroup,
  update,
  updateParam,
  remove,
  duplicate,
  add,
  tableRef,
  onTableKey,
  flavorColorMap,
  dimColorMaps,
  dimHasGroup,
  hasAnyFlavor,
  genLoading,
  onGenExample,
  onPickImage,
  onQuickEntry,
}: SkusSectionProps) {
  if (skus.length === 0) {
    return (
      <EmptyState
        genLoading={genLoading}
        onGenExample={onGenExample}
        onPickImage={onPickImage}
        onQuickEntry={onQuickEntry}
        onAdd={add}
      />
    )
  }

  return (
    <div className="glass rounded-2xl overflow-hidden">
      {/* 分组折叠工具栏 */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-edge bg-brand-soft/50 flex-wrap">
        <span className="text-xs text-slate-500">分组折叠：</span>
        {(() => {
          // 动态构建分组选项，并过滤掉无区分意义的（所有 SKU 在该维度值相同）
          const allOptions: Array<{ key: string; label: string; getValue: (s: Sku) => string }> = [
            { key: 'flavor', label: `按${flavorLabel}`, getValue: (s) => parseFlavor(s.name).flavor || '（无）' },
            { key: 'quantity', label: '按规格', getValue: (s) => `${s.quantity}${s.unit}` },
            { key: 'packs', label: '按件数', getValue: (s) => `${s.packs}件` },
            ...dims.map((d): { key: string; label: string; getValue: (s: Sku) => string } => ({
              key: `dim:${d.id}`,
              label: `按${d.label}`,
              getValue: (s) => String(s.params?.[d.id] ?? '（未设）'),
            })),
          ]
          // 只保留"能真正聚合成组"的维度：
          // 1) 至少 2 个不同值（否则只有 1 组=无分组意义）
          // 2) 去重后值数量 < SKU 总数（否则每组只有 1 个 SKU=只是排序不是分组）
          const options = allOptions.filter((opt) => {
            if (skus.length < 3) return false
            const values = new Set(skus.map(opt.getValue))
            return values.size > 1 && values.size < skus.length
          })
          if (options.length === 0) return null
          return options.map((opt) => {
            const active = groupBy === opt.key
            return (
              <button
                key={opt.key}
                onClick={() => {
                  onSetCollapsed(new Set())
                  onSetGroupBy(active ? null : (opt.key as GroupBy))
                }}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                  active
                    ? 'bg-brand/20 text-brand border border-brand/50'
                    : 'text-slate-400 border border-edge hover:text-brand-deep hover:border-brand/40'
                }`}
              >
                {opt.label}
              </button>
            )
          })
        })()}
        {groupBy && (
          <button
            onClick={() => { onSetCollapsed(new Set()); onSetGroupBy(null) }}
            className="text-xs text-slate-500 hover:text-brand-deep ml-1"
          >
            取消分组
          </button>
        )}
        <span className="text-xs text-slate-400 ml-auto hidden sm:block">
          Enter 跳转下一格 · Ctrl+Enter 快速加行
        </span>
      </div>

      {/* 桌面表格：内部滚动 + 吸附表头；移动端为卡片式录入 */}
      <div className="hidden sm:block overflow-auto max-h-[72vh]">
        <table ref={tableRef} onKeyDown={onTableKey} className="w-full text-sm min-w-[1040px]">
          <thead>
            <tr>
              <th className={`${TH_BASE} w-8`}>#</th>
              <th className={TH_BASE}>{flavorLabel}</th>
              <th className={TH_BASE}>规格（含量×件数）</th>
              <th className={TH_BASE}>总价 ¥</th>
              <th className={TH_BASE}>单件含量</th>
              <th className={TH_BASE}>计量单位</th>
              <th className={TH_BASE}>件数</th>
              {dims.map((dim) => (
                <th key={dim.id} className={TH_BASE}>
                  {dim.label}
                  {dim.unit && <span className="text-xs text-slate-400 ml-1">({dim.unit})</span>}
                </th>
              ))}
              <th className={`${TH_BASE} text-right`}>总量</th>
              <th className={`${TH_BASE} text-right`}>每件价</th>
              <th className={`${TH_BASE} text-right`}>每单位价</th>
              <th className={`${TH_BASE} w-16`} />
            </tr>
          </thead>
          {/* key 随 groupBy 变化，切换分组维度时整体重挂载，避免旧分组行残留 */}
          <tbody key={groupBy ?? 'none'}>
            {(groupBy ? groupSkus(skus, groupBy) : [{ key: '__all__', items: skus }]).map(
              (group) => {
                const isGrouped = groupBy !== null
                const isCollapsed = collapsed.has(group.key)
                return (
                  <GroupRows
                    key={group.key}
                    groupKey={group.key}
                    items={group.items}
                    allSkus={skus}
                    isGrouped={isGrouped}
                    isCollapsed={isCollapsed}
                    onToggle={() => onToggleGroup(group.key)}
                    update={update}
                    updateParam={updateParam}
                    remove={remove}
                    duplicate={duplicate}
                    dims={dims}
                    flavorLabel={flavorLabel}
                    flavorColorMap={flavorColorMap}
                    dimColorMaps={dimColorMaps}
                    dimHasGroup={dimHasGroup}
                    hasAnyFlavor={hasAnyFlavor}
                  />
                )
              },
            )}
          </tbody>
        </table>
      </div>

      {/* 移动端：卡片式录入（与表格共用分组折叠状态） */}
      <div className="sm:hidden px-3 py-3 space-y-2">
        {(groupBy ? groupSkus(skus, groupBy) : [{ key: '__all__', items: skus }]).map((group) => {
          const isGrouped = groupBy !== null
          const isCollapsed = collapsed.has(group.key)
          return (
            <div key={group.key} className="space-y-2">
              {isGrouped && (
                <button
                  onClick={() => onToggleGroup(group.key)}
                  className="w-full flex items-center gap-2 rounded-lg bg-brand-soft/60 px-3 py-2 text-xs font-semibold text-slate-600 select-none"
                >
                  <ChevronDown
                    className={`h-3.5 w-3.5 text-brand transition-transform duration-200 ${
                      isCollapsed ? '-rotate-90' : ''
                    }`}
                  />
                  <span className="text-brand">{group.key}</span>
                  <span className="text-slate-500 font-normal">（{group.items.length} 个规格）</span>
                </button>
              )}
              {!isCollapsed &&
                group.items.map((s) => {
                  const idx = skus.findIndex((x) => x.id === s.id)
                  return (
                    <SkuRowCard
                      key={s.id}
                      s={s}
                      idx={idx}
                      update={update}
                      updateParam={updateParam}
                      remove={remove}
                      duplicate={duplicate}
                      dims={dims}
                      flavorLabel={flavorLabel}
                      flavorColorMap={flavorColorMap}
                      dimColorMaps={dimColorMaps}
                      dimHasGroup={dimHasGroup}
                      hasAnyFlavor={hasAnyFlavor}
                    />
                  )
                })}
            </div>
          )
        })}
      </div>

      {/* 表尾：添加行 */}
      <button
        onClick={add}
        className="w-full py-3 text-xs text-slate-500 hover:text-brand hover:bg-brand-soft/70 transition-all flex items-center justify-center gap-1.5 border-t border-edge"
      >
        <Plus className="h-4 w-4" /> 添加一行规格
      </button>
    </div>
  )
}
