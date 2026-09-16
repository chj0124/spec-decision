import type { ParamDim, ParamValue, Sku } from '../../lib/types'
import { ChevronDown } from 'lucide-react'
import { RowFields } from './RowFields'

export interface GroupRowsProps {
  groupKey: string
  items: Sku[]
  allSkus: Sku[]
  isGrouped: boolean
  isCollapsed: boolean
  onToggle: () => void
  update: (id: string, patch: Partial<Sku>) => void
  updateParam: (id: string, dimId: string, value: ParamValue) => void
  remove: (id: string) => void
  duplicate: (id: string) => void
  dims: ParamDim[]
  flavorLabel: string
  flavorColorMap: Map<string, string>
  dimColorMaps: Map<string, string>[]
  dimHasGroup: boolean[]
  hasAnyFlavor: boolean
}

export function GroupRows({ groupKey, items, allSkus, isGrouped, isCollapsed, onToggle, update, updateParam, remove, duplicate, dims, flavorLabel, flavorColorMap, dimColorMaps, dimHasGroup, hasAnyFlavor }: GroupRowsProps) {
  // 列数：# + 口味 + 规格 + 总价 + 含量 + 单位 + 数量 + N个维度 + 总量 + 每件价 + 每单位价 + 操作
  const colCount = 11 + dims.length
  return (
    <>
      {/* 分组标题行（仅分组时显示） */}
      {isGrouped && (
        <tr
          onClick={onToggle}
          className="border-b border-edge bg-brand-soft/60 cursor-pointer hover:bg-brand-soft/70 transition-colors select-none"
        >
          <td colSpan={colCount} className="px-3 py-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
              <ChevronDown
                className={`h-3.5 w-3.5 text-brand transition-transform duration-200 ${
                  isCollapsed ? '-rotate-90' : ''
                }`}
              />
              <span className="text-brand">{groupKey}</span>
              <span className="text-slate-500 font-normal">（{items.length} 个规格）</span>
            </div>
          </td>
        </tr>
      )}

      {/* 数据行 */}
      {!isCollapsed &&
        items.map((s) => {
          const idx = allSkus.findIndex((x) => x.id === s.id)
          return (
            <RowFields
              key={s.id}
              s={s}
              idx={idx}
              update={update}
              updateParam={updateParam}
              remove={remove}
              indented={isGrouped}
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
    </>
  )
}
