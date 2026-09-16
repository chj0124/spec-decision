import type { ParamDim, ParamValue, Sku } from '../../lib/types'
import { fmt } from '../../lib/engine'
import { motion } from 'framer-motion'
import { Copy, Trash2 } from 'lucide-react'
import { AutoWidthInput } from './AutoWidthInput'
import { DimInput } from './DimInput'
import { PriceTrendBadge } from './PriceTrendBadge'
import { PriceAgeBadge } from './PriceAgeBadge'
import { PricePositionBadge } from './PricePositionBadge'
import { useSkuRow } from './useSkuRow'

export interface RowFieldsProps {
  s: Sku
  idx: number
  update: (id: string, patch: Partial<Sku>) => void
  updateParam: (id: string, dimId: string, value: ParamValue) => void
  remove: (id: string) => void
  duplicate: (id: string) => void
  indented: boolean
  dims: ParamDim[]
  flavorLabel: string
  flavorColorMap: Map<string, string>
  dimColorMaps: Map<string, string>[]
  dimHasGroup: boolean[]
  hasAnyFlavor: boolean
}

export function RowFields({ s, idx, update, updateParam, remove, duplicate, indented, dims, flavorLabel, flavorColorMap, dimColorMaps, dimHasGroup, hasAnyFlavor }: RowFieldsProps) {
  const { total, up, packPrice, incomplete, flavor, spec, setName, handleSpec, handleField } = useSkuRow(s, update)

  // 同口味行用同底色，仅多口味时上色；待补充行保留警告色
  const flavorBg = !incomplete && hasAnyFlavor && flavor ? flavorColorMap.get(flavor) ?? '' : ''

  return (
    <motion.tr
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className={`border-b border-edge/50 group transition-colors ${
        incomplete ? 'bg-amber-400/[0.03]' : 'hover:bg-brand-soft/50'
      } ${flavorBg}`}
    >
      <td className="px-3 py-2 text-slate-500 font-mono text-xs">
        {indented && <span className="text-edge mr-1">·</span>}
        {String(idx + 1).padStart(2, '0')}
      </td>
      {/* 口味/型号/颜色（根据商品类型自适应） */}
      <td className="px-3 py-2">
        <AutoWidthInput
          value={flavor}
          onChange={(e) => setName(e.target.value, spec)}
          placeholder={flavorLabel}
          minWidth={48}
          className="field py-1.5 text-xs"
        />
      </td>
      {/* 规格（含量×件数），与单件含量/计量单位/件数双向同步 */}
      <td className="px-3 py-2">
        <AutoWidthInput
          value={spec}
          onChange={(e) => handleSpec(e.target.value)}
          placeholder="如 16g×8袋"
          minWidth={80}
          title="改这里会同步 含量/单位/数量"
          className="field py-1.5 text-xs font-medium"
        />
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <AutoWidthInput
            type="number" min={0} step="0.01" value={s.price || ''}
            onChange={(e) => update(s.id, { price: parseFloat(e.target.value) || 0 })}
            placeholder="4.94" minWidth={64} extra={24}
            className="field py-1.5 text-xs tabular"
          />
          <PriceTrendBadge history={s.priceHistory} />
          <PricePositionBadge history={s.priceHistory} targetPrice={s.targetPrice} />
          <PriceAgeBadge history={s.priceHistory} />
        </div>
      </td>
      <td className="px-3 py-2">
        <AutoWidthInput
          type="number" min={0} value={s.quantity || ''}
          onChange={(e) => handleField('quantity', parseFloat(e.target.value) || 0)}
          placeholder="16"
          minWidth={48} extra={24}
          title="改这里会同步规格描述"
          className="field py-1.5 text-xs tabular"
        />
      </td>
      <td className="px-3 py-2">
        <AutoWidthInput
          value={s.unit}
          onChange={(e) => handleField('unit', e.target.value)}
          placeholder="g"
          list="unit-options"
          minWidth={56} extra={24}
          className="field py-1.5 text-xs"
        />
      </td>
      <td className="px-3 py-2">
        <AutoWidthInput
          type="number" min={1} value={s.packs || ''}
          onChange={(e) => handleField('packs', parseInt(e.target.value) || 1)}
          placeholder="8"
          minWidth={48} extra={24}
          title="改这里会同步规格描述"
          className="field py-1.5 text-xs tabular"
        />
      </td>
      {/* 动态维度列：有分组时加左侧色条 */}
      {dims.map((dim, dIdx) => {
        const v = String(s.params?.[dim.id] ?? '')
        const barColor = dimHasGroup[dIdx] ? dimColorMaps[dIdx].get(v) : undefined
        return (
          <td
            key={dim.id}
            className="px-3 py-2"
            style={barColor ? { borderLeft: `3px solid ${barColor}` } : undefined}
          >
            <DimInput dim={dim} s={s} updateParam={updateParam} />
          </td>
        )
      })}
      <td className="px-3 py-2 text-right text-xs text-slate-400 tabular whitespace-nowrap">
        {total > 0 ? `${fmt.num(total)}${s.unit}` : '—'}
      </td>
      {/* 每件价：整箱商品的直觉单位（"这箱 24 瓶 ¥49.7，合一瓶多少"），与每 ml 价互补 */}
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <span className={`text-xs font-semibold tabular ${packPrice > 0 ? 'text-slate-600' : 'text-slate-400'}`}>
          {packPrice > 0 ? fmt.price4(packPrice) : '待补充'}
        </span>
        {packPrice > 0 && <span className="text-sm text-slate-500">/{s.packUnit || '件'}</span>}
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <span className={`text-xs font-semibold tabular ${up > 0 ? 'text-brand' : 'text-slate-600'}`}>
          {up > 0 ? fmt.price4(up) : '待补充'}
        </span>
        {up > 0 && <span className="text-sm text-slate-500">/{s.unit}</span>}
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex items-center justify-end gap-1.5">
          <button
            onClick={() => duplicate(s.id)}
            className="text-slate-600 hover:text-brand transition-colors opacity-0 group-hover:opacity-100"
            aria-label="复制此行"
            title="同款复制：只改规格与价格"
          >
            <Copy className="h-4 w-4" />
          </button>
          <button
            onClick={() => remove(s.id)}
            className="text-slate-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
            aria-label="删除此行"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </td>
    </motion.tr>
  )
}
