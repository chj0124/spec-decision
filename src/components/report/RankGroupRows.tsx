import type { ComputedSku } from '../../lib/types'
import { motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { fmt, displayQuantity, displayUnitPrice, displayUnit, parseFlavor } from '../../lib/engine'
import { RANK_ICON, RANK_STYLE } from './constants'

/* ============ 全量视图：分组折叠行 ============ */

export interface RankGroupRowsProps {
  groupKey: string
  groupItems: ComputedSku[]
  allItems: ComputedSku[]
  isGrouped: boolean
  isCollapsed: boolean
  onToggle: () => void
  flavorColorMap: Map<string, string>
}

export function RankGroupRows({
  groupKey,
  groupItems,
  allItems,
  isGrouped,
  isCollapsed,
  onToggle,
  flavorColorMap,
}: RankGroupRowsProps) {
  // 列数：# + 规格 + 总价 + 总量 + 每单位 + 每包 = 6
  const colCount = 6
  return (
    <>
      {/* 分组标题行（仅分组时显示） */}
      {isGrouped && (
        <tr
          onClick={onToggle}
          className="border-b border-edge bg-brand-soft/60 cursor-pointer hover:bg-brand-soft/70 transition-colors select-none"
        >
          <td colSpan={colCount} className="px-2 py-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
              <ChevronDown
                className={`h-3.5 w-3.5 text-brand transition-transform duration-200 ${
                  isCollapsed ? '-rotate-90' : ''
                }`}
              />
              <span className="text-brand">{groupKey}</span>
              <span className="text-slate-500 font-normal">（{groupItems.length} 个规格）</span>
            </div>
          </td>
        </tr>
      )}

      {/* 数据行：折叠时隐藏，分组内排名按 allItems 中的位置；逐行错峰淡入 */}
      {!isCollapsed &&
        groupItems.map((item, rowIdx) => {
          // 用全局排名（item.rank 已按得分排序），前三名用奖牌图标
          const idx = allItems.findIndex((x) => x.id === item.id)
          const RankIcon = RANK_ICON[idx]
          const { flavor } = parseFlavor(item.name)
          const flavorBg = flavor ? flavorColorMap.get(flavor) ?? '' : ''
          return (
            <motion.tr
              key={item.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2, delay: Math.min(rowIdx * 0.04, 0.3) }}
              className={`border-b border-edge/50 hover:bg-brand-soft/30 transition-colors ${
                item.isBest ? 'bg-brand/5' : ''
              } ${flavorBg && !item.isBest ? flavorBg : ''}`}
            >
              <td className="px-2 py-2.5 text-center">
                <div
                  className={`inline-flex h-7 w-7 rounded-lg items-center justify-center font-bold text-white ${
                    RANK_STYLE[idx] ?? 'bg-edge text-slate-600'
                  }`}
                >
                  {RankIcon ? <RankIcon className="h-3.5 w-3.5" /> : (
                    <span className="tabular text-xs">{item.rank}</span>
                  )}
                </div>
              </td>
              <td className="px-2 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate max-w-[180px]" title={item.name}>{item.name}</span>
                  {item.isBest && (
                    <span className="px-1.5 py-0.5 rounded bg-brand/15 text-brand text-xs font-semibold">推荐</span>
                  )}
                </div>
              </td>
              <td className="px-2 py-2.5 text-right tabular text-brand-deep">{fmt.yuan(item.price)}</td>
              <td className="px-2 py-2.5 text-right tabular text-brand-deep">{fmt.num(displayQuantity(item.totalQuantity, item.unit))}{displayUnit(item.unit)}</td>
              <td className="px-2 py-2.5 text-right tabular font-semibold text-brand">{fmt.priceUnit(displayUnitPrice(item.unitPrice, item.unit))}</td>
              <td className="px-2 py-2.5 text-right tabular text-slate-500 dark:text-slate-300">{fmt.yuan(item.packPrice)}</td>
            </motion.tr>
          )
        })}
    </>
  )
}
