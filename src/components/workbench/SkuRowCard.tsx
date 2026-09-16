import type { ParamDim, ParamValue, Sku } from '../../lib/types'
import { fmt } from '../../lib/engine'
import { motion } from 'framer-motion'
import { Copy, Trash2 } from 'lucide-react'
import { DimInput } from './DimInput'
import { PriceTrendBadge } from './PriceTrendBadge'
import { PriceAgeBadge } from './PriceAgeBadge'
import { useSkuRow } from './useSkuRow'

export interface SkuRowCardProps {
  s: Sku
  idx: number
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

export function SkuRowCard({ s, idx, update, updateParam, remove, duplicate, dims, flavorLabel, flavorColorMap, dimColorMaps, dimHasGroup, hasAnyFlavor }: SkuRowCardProps) {
  const { total, up, packPrice, incomplete, flavor, spec, setName, handleSpec, handleField } = useSkuRow(s, update)
  const flavorBg = !incomplete && hasAnyFlavor && flavor ? flavorColorMap.get(flavor) ?? '' : ''

  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className={`rounded-xl border p-3 space-y-2.5 ${
        incomplete ? 'border-amber-400/40 bg-amber-400/[0.03]' : 'border-edge bg-panel/60'
      } ${flavorBg}`}
    >
      {/* 首行：序号 + 口味 + 规格 + 删除 */}
      <div className="flex items-center gap-2">
        <span className="text-slate-400 font-mono text-xs shrink-0">{String(idx + 1).padStart(2, '0')}</span>
        <input
          value={flavor}
          onChange={(e) => setName(e.target.value, spec)}
          placeholder={flavorLabel}
          className="field py-1.5 text-xs flex-1 min-w-0"
        />
        <input
          value={spec}
          onChange={(e) => handleSpec(e.target.value)}
          placeholder="如 16g×8袋"
          title="改这里会同步 含量/单位/数量"
          className="field py-1.5 text-xs font-medium flex-[1.3] min-w-0"
        />
        <button
          onClick={() => duplicate(s.id)}
          className="text-slate-400 hover:text-brand transition-colors shrink-0"
          aria-label="复制此行"
          title="同款复制：只改规格与价格"
        >
          <Copy className="h-4 w-4" />
        </button>
        <button
          onClick={() => remove(s.id)}
          className="text-slate-400 hover:text-red-400 transition-colors shrink-0"
          aria-label="删除此行"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* 数值区：总价 / 含量 / 单位 / 数量 */}
      <div className="grid grid-cols-4 gap-2">
        <label className="block min-w-0">
          <span className="text-[10px] text-slate-400 mb-0.5 flex items-center gap-1">
            总价 ¥
            <PriceTrendBadge history={s.priceHistory} />
            <PriceAgeBadge history={s.priceHistory} />
          </span>
          <input
            type="number" min={0} step="0.01" value={s.price || ''}
            onChange={(e) => update(s.id, { price: parseFloat(e.target.value) || 0 })}
            placeholder="4.94"
            className="field py-1.5 text-xs tabular"
          />
        </label>
        <label className="block min-w-0">
          <span className="text-[10px] text-slate-400 mb-0.5 block">单件含量</span>
          <input
            type="number" min={0} value={s.quantity || ''}
            onChange={(e) => handleField('quantity', parseFloat(e.target.value) || 0)}
            placeholder="16"
            title="改这里会同步规格描述"
            className="field py-1.5 text-xs tabular"
          />
        </label>
        <label className="block min-w-0">
          <span className="text-[10px] text-slate-400 mb-0.5 block">计量单位</span>
          <input
            value={s.unit}
            onChange={(e) => handleField('unit', e.target.value)}
            placeholder="g"
            list="unit-options"
            className="field py-1.5 text-xs"
          />
        </label>
        <label className="block min-w-0">
          <span className="text-[10px] text-slate-400 mb-0.5 block">件数</span>
          <input
            type="number" min={1} value={s.packs || ''}
            onChange={(e) => handleField('packs', parseInt(e.target.value) || 1)}
            placeholder="8"
            title="改这里会同步规格描述"
            className="field py-1.5 text-xs tabular"
          />
        </label>
      </div>

      {/* 参数维度：有分组时带左侧色条 */}
      {dims.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-2">
          {dims.map((dim, dIdx) => {
            const v = String(s.params?.[dim.id] ?? '')
            const barColor = dimHasGroup[dIdx] ? dimColorMaps[dIdx].get(v) : undefined
            return (
              <div
                key={dim.id}
                className="min-w-0"
                style={barColor ? { borderLeft: `3px solid ${barColor}`, paddingLeft: 8 } : undefined}
              >
                <span className="text-[10px] text-slate-400 mb-0.5 block">
                  {dim.label}{dim.unit ? `(${dim.unit})` : ''}
                </span>
                <DimInput dim={dim} s={s} updateParam={updateParam} />
              </div>
            )
          })}
        </div>
      )}

      {/* 底栏：总量 + 每件价 + 每单位价 */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs pt-2 border-t border-edge/50">
        <span className="text-slate-400 tabular">
          {total > 0 ? `总量 ${fmt.num(total)}${s.unit}` : '总量 —'}
        </span>
        {packPrice > 0 && (
          <span className="text-slate-400 tabular">
            每件 {fmt.price4(packPrice)}/{s.packUnit || '件'}
          </span>
        )}
        <span className={`font-semibold tabular ${up > 0 ? 'text-brand' : 'text-slate-400'}`}>
          {up > 0 ? `${fmt.price4(up)}/${s.unit}` : '待补充'}
        </span>
      </div>
    </motion.div>
  )
}
