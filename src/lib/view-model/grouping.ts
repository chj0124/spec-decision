import type { ComputedSku } from '../types'
import { parseFlavor } from '../engine'

/** 全量视图分组维度选项 key 类型 */
export type FullGroupBy = 'flavor' | 'quantity' | 'packs'

/** 按 dimension 对 ComputedSku 分组（保留派生字段，避免丢 packPrice 等） */
export function groupComputedSkus(
  skus: ComputedSku[],
  by: FullGroupBy,
  flavorLabel: string,
): Array<{ key: string; items: ComputedSku[] }> {
  const map = new Map<string, ComputedSku[]>()
  for (const s of skus) {
    let key = ''
    if (by === 'flavor') key = parseFlavor(s.name).flavor || `（无${flavorLabel}）`
    else if (by === 'quantity') key = `${s.quantity}${s.unit}`
    else if (by === 'packs') key = `${s.packs}件`
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(s)
  }
  return [...map.entries()].map(([key, items]) => ({ key, items }))
}

/** 分组维度候选：过滤掉无区分意义的（所有 SKU 值相同 / 每组仅1项） */
export function deriveGroupOptions(
  items: ComputedSku[],
  flavorLabel: string,
): Array<{ key: FullGroupBy; label: string }> {
  if (items.length < 3) return []
  const opts: Array<{ key: FullGroupBy; label: string; getVal: (s: ComputedSku) => string }> = [
    { key: 'flavor', label: `按${flavorLabel}`, getVal: (s) => parseFlavor(s.name).flavor || '' },
    { key: 'quantity', label: '按单件含量', getVal: (s) => `${s.quantity}${s.unit}` },
    { key: 'packs', label: '按件数', getVal: (s) => `${s.packs}件` },
  ]
  return opts
    .filter((o) => {
      const vals = new Set(items.map(o.getVal))
      return vals.size >= 2 && vals.size < items.length
    })
    .map(({ key, label }) => ({ key, label }))
}
