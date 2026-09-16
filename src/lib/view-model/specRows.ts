import type { ComputedSku } from '../types'
import { mergeVariantSkus, displayUnitPrice, displayQuantity } from '../engine'
import { shortSpec } from './text'

/** 主视觉用的单条规格（已合并同价同规格的口味变体，并按展示单位换算） */
export interface SpecRow {
  id: string
  /** 轴标签短名 */
  name: string
  /** 悬停 tooltip 用的完整名 */
  fullName: string
  /** 每展示单位单价（如 ¥/L） */
  perUnit: number
  /** 总量（展示单位） */
  qty: number
  /** 每 100 元能买到的展示单位量 */
  per100: number
  /** 相对全场最贵单价、按本档总量折算出的省下金额（¥） */
  savings: number
}

/**
 * 主视觉数据：先合并「同价同规格」的口味变体，再统一换算到展示单位（ml→L），
 * 让「每单位单价」成为全场唯一标尺。省下金额 = 相比全场最贵单价、按本档总量折算。
 */
export function deriveSpecRows(items: ComputedSku[]): SpecRow[] {
  const rows: SpecRow[] = mergeVariantSkus(items).map((m) => {
    const perUnit = displayUnitPrice(m.unitPrice, m.unit)
    return {
      id: m.id,
      name: shortSpec(m.name),
      fullName: m.name,
      // 单价保留 4 位小数：升档到"每瓶便宜 0.008 元"这种量级也能看出差别
      perUnit: Math.round(perUnit * 1e4) / 1e4,
      qty: displayQuantity(m.totalQuantity, m.unit),
      per100: perUnit > 0 ? Math.round((100 / perUnit) * 100) / 100 : 0,
      savings: 0,
    }
  })
  const maxPerUnit = rows.reduce((mx, r) => Math.max(mx, r.perUnit), 0)
  for (const r of rows) r.savings = Math.round((maxPerUnit - r.perUnit) * r.qty * 100) / 100
  return rows
}

/**
 * 高亮锚点：优先冠军规格；万一它被合并进同价变体，就退而选单价最低的那条。
 * 预算偏好下可能一条都不剩（items 为空），此时给空串兜底——空态不渲染主视觉，
 * 但在 return 之前求值，不给兜底会直接抛错把整个报告页打崩。
 */
export function deriveVisualAnchorId(specRows: SpecRow[], bestId?: string): string {
  return (
    specRows.find((r) => r.id === bestId)?.id ??
    (specRows.length > 0
      ? specRows.reduce((min, r) => (r.perUnit < min.perUnit ? r : min), specRows[0]).id
      : '')
  )
}

/** 「最划算一档相对最贵一档」的一句话结论数据 */
export interface OneLiner {
  anchor: SpecRow
  worst: SpecRow
  /** 每展示单位省下的钱 */
  savePerUnit: number
  /** 相对最贵单价的降幅（%） */
  pct: number
  /** 按本档总量折算，等量买入能省下的总额（¥） */
  vsWorst: number
}

/**
 * 一句话结论：把"最划算"折算成「每单位省了多少钱 + 便宜百分之几 + 等量能省多少」，
 * 不读表格也能直接拿到性价比结论。数据不足（<2 档 / 锚点无效 / 锚点即最贵）时返回 null。
 */
export function deriveOneLiner(specRows: SpecRow[], visualAnchorId: string): OneLiner | null {
  if (specRows.length < 2) return null
  const anchor = specRows.find((r) => r.id === visualAnchorId)
  if (!anchor || anchor.perUnit <= 0) return null
  let worst = specRows[0]
  for (const r of specRows) if (r.perUnit > worst.perUnit) worst = r
  if (worst.id === anchor.id) return null
  const savePerUnit = worst.perUnit - anchor.perUnit
  return {
    anchor,
    worst,
    savePerUnit,
    pct: (savePerUnit / worst.perUnit) * 100,
    vsWorst: savePerUnit * anchor.qty,
  }
}
