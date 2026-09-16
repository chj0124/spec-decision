import { useState } from 'react'
import type { SkuCluster } from '../../lib/types'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { fmt, displayUnit, displayQuantity, displayUnitPrice } from '../../lib/engine'
import { packWord } from '../../lib/view-model'
import { RANK_ICON, RANK_STYLE } from './constants'

/** 簇卡片：一个定价规格 + 簇内多口味标签切换。先比价格，再挑口味。 */
export function ClusterCard({ cluster, idx, flavorLabel }: { cluster: SkuCluster; idx: number; flavorLabel: string }) {
  const RankIcon = RANK_ICON[idx]
  // 默认选中簇内最省钱的成员
  const cheapest = cluster.members[0]
  const [activeId, setActiveId] = useState<string>(cheapest?.id ?? '')
  const active = cluster.members.find((m: { id: string }) => m.id === activeId) ?? cheapest
  const hasFlavors = cluster.members.length > 1

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: idx * 0.06 }}
      className={`glass rounded-2xl p-4 ${
        cluster.isBest ? 'ring-1 ring-brand/50 shadow-glow' : ''
      }`}
    >
      <div className="flex items-center gap-4">
        <div
          className={`h-11 w-11 rounded-xl grid place-items-center shrink-0 font-bold text-white ${
            RANK_STYLE[idx] ?? 'bg-edge text-slate-600'
          }`}
        >
          {RankIcon ? <RankIcon className="h-5 w-5" /> : <span className="tabular">{cluster.rank}</span>}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{cluster.label}</span>
            {cluster.isBest && (
              <span className="text-sm px-1.5 py-0.5 rounded bg-brand/15 text-brand font-semibold">
                推荐
              </span>
            )}
            {hasFlavors && (
              <span className="text-sm px-1.5 py-0.5 rounded bg-slate-500/15 text-slate-500 dark:text-slate-300">
                {cluster.members.length} 种{flavorLabel}
              </span>
            )}
          </div>
          <div className="text-sm text-slate-500 mt-0.5 tabular">
            {cluster.priceSpread > 0
              ? `${fmt.yuan(cluster.minPrice)} ~ ${fmt.yuan(cluster.maxPrice)}`
              : `${fmt.yuan(active.price)}`}{' '}
            · 共 {fmt.num(displayQuantity(cluster.quantity * cluster.packs, cluster.unit))}{displayUnit(cluster.unit)}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-base font-bold tabular">
            <span className="text-brand">{fmt.priceUnit(displayUnitPrice(cluster.repUnitPrice, cluster.unit))}</span>
            <span className="text-sm text-slate-500 font-normal"> /{displayUnit(cluster.unit)}</span>
          </div>
          <div className="text-sm text-slate-500">每{packWord(cluster.packs, cluster.packUnit)} {fmt.yuan(active.price / Math.max(1, cluster.packs))}</div>
        </div>
      </div>

      {/* 簇内口味标签：价格已比完，这里只挑口味 */}
      {hasFlavors && (
        <div className="mt-3 pt-3 border-t border-edge/60">
          <div className="text-sm text-slate-500 mb-2 flex items-center gap-1">
            <ChevronDown className="h-3 w-3" />
            价格结构相同，挑个{flavorLabel}即可
            {cluster.priceSpread > 0 && (
              <span className="text-amber-400/80 ml-1">（{flavorLabel}间有价差，已按最省钱排序）</span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {cluster.members.map((m: { id: string; name: string; price: number; flavor?: string }) => (
              <button
                key={m.id}
                onClick={() => setActiveId(m.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all tabular ${
                  m.id === activeId
                    ? 'bg-brand/20 text-brand border border-brand/50'
                    : 'bg-brand-soft/50 text-slate-400 border border-edge hover:text-brand-deep hover:border-brand/40'
                }`}
              >
                {m.name}
                <span className="ml-1.5 opacity-70">{fmt.yuan(m.price)}</span>
              </button>
            ))}
          </div>
          <AnimatePresence mode="wait">
            <motion.p
              key={activeId}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className="text-sm text-slate-400 mt-2"
            >
              已选 <span className="text-brand-deep font-medium">{active.name}</span>：
              {fmt.yuan(active.price)}，每{displayUnit(active.unit)} {fmt.priceUnit(displayUnitPrice(active.unitPrice, active.unit))}
            </motion.p>
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  )
}
