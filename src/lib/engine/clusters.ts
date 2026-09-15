import type { ComputedSku, ParamValue, Preference, SkuCluster } from '../types'
import { round, fmt } from './util'

/**
 * 把「quantity × packs × unit 相同、且参数维度也相同」的规格归为一簇——
 * 它们才是同一款商品，差异只在口味/颜色等「不影响单价」的干扰维度上。
 * 决策时以簇为单位比价，簇内再挑口味，把 12 选 1 降维成 4 选 1。
 *
 * 关键：聚类 key 必须包含参数签名。否则同一存储/含量下若出现参数不同的商品
 * （如 256GB 手机有 12G/8G 内存、不同电池），会被误并成一簇、当成"同款不同口味"，
 * 掩盖真实的规格/价格差异。只有参数完全一致（仅干扰维度不同）才合并。
 */
function paramSignature(params?: Record<string, ParamValue>): string {
  if (!params) return ''
  return Object.keys(params)
    .sort()
    .map((k) => `${k}=${JSON.stringify(params[k])}`)
    .join('&')
}

export function clusterItems(items: ComputedSku[]): SkuCluster[] {
  const map = new Map<string, ComputedSku[]>()
  for (const item of items) {
    const key = `${item.quantity}|${item.packs}|${item.unit}|${paramSignature(item.params)}`
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(item)
  }

  const clusters: SkuCluster[] = []
  for (const [key, members] of map) {
    const sortedMembers = [...members].sort((a, b) => a.unitPrice - b.unitPrice)
    const rep = sortedMembers[0] // 簇内最省钱者作为决策代表
    const prices = members.map((m) => m.price)
    const minPrice = Math.min(...prices)
    const maxPrice = Math.max(...prices)
    const score = Math.max(...members.map((m) => m.score))
    const label = `${fmt.num(rep.quantity)}${rep.unit} × ${rep.packs}${rep.packUnit || '件'}`

    clusters.push({
      key,
      quantity: rep.quantity,
      packs: rep.packs,
      unit: rep.unit,
      members: sortedMembers,
      repUnitPrice: rep.unitPrice,
      minPrice,
      maxPrice,
      priceSpread: round(maxPrice - minPrice, 2),
      score,
      rank: 0,
      isBest: false,
      label,
    })
  }

  return clusters
    .sort((a, b) => b.score - a.score || a.repUnitPrice - b.repUnitPrice)
    .map((c, idx) => ({ ...c, rank: idx + 1, isBest: idx === 0 }))
}

/** 按决策偏好排序，返回带 rank/isBest 的列表 */
export function rankByPreference(
  scored: ComputedSku[],
  preference: Preference,
  budget?: number,
): ComputedSku[] {
  let pool = scored
  if (preference === 'budget' && typeof budget === 'number' && budget > 0) {
    pool = scored.filter((i) => i.price <= budget!)
  }
  const cmp =
    preference === 'value'
      ? (a: ComputedSku, b: ComputedSku) => a.unitPrice - b.unitPrice // 性价比优先
      : (a: ComputedSku, b: ComputedSku) => b.score - a.score // 综合/预算优先均按 score
  return [...pool].sort(cmp).map((item, idx) => ({
    ...item,
    rank: idx + 1,
    isBest: idx === 0,
  }))
}
