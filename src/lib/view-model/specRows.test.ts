import { describe, it, expect } from 'vitest'
import { deriveSpecRows, deriveVisualAnchorId, deriveOneLiner } from './specRows'
import type { ComputedSku } from '../types'

const csku = (over: Partial<ComputedSku> = {}): ComputedSku => {
  const quantity = over.quantity ?? 100
  const packs = over.packs ?? 1
  const price = over.price ?? 10
  const totalQuantity = over.totalQuantity ?? quantity * packs
  return {
    id: over.id ?? 'x',
    name: over.name ?? '测试',
    price,
    quantity,
    unit: over.unit ?? 'g',
    packs,
    totalQuantity,
    unitPrice: over.unitPrice ?? price / totalQuantity,
    packPrice: over.packPrice ?? price / packs,
    score: over.score ?? 50,
    rank: over.rank ?? 1,
    isBest: over.isBest ?? false,
    ...over,
  }
}

describe('deriveSpecRows 主视觉规格行', () => {
  it('按展示单位换算单价与总量，并计算每 100 元可买量', () => {
    const rows = deriveSpecRows([
      csku({ id: 'a', name: '原味 500ml×6瓶', unit: 'ml', totalQuantity: 3000, unitPrice: 0.01, price: 30 }),
      csku({ id: 'b', name: '原味 500ml×12瓶', unit: 'ml', totalQuantity: 6000, unitPrice: 0.008, price: 48 }),
    ])
    expect(rows.map((r) => r.id)).toEqual(['a', 'b'])
    expect(rows[0].perUnit).toBe(10) // 每 L
    expect(rows[0].qty).toBe(3)
    expect(rows[0].per100).toBe(10)
    expect(rows[1].perUnit).toBe(8)
    expect(rows[1].per100).toBe(12.5)
  })

  it('省下金额 = 相比全场最贵单价、按本档总量折算', () => {
    const rows = deriveSpecRows([
      csku({ id: 'a', unit: 'ml', totalQuantity: 3000, unitPrice: 0.01 }),
      csku({ id: 'b', unit: 'ml', totalQuantity: 6000, unitPrice: 0.008 }),
    ])
    expect(rows[0].savings).toBe(0)
    expect(rows[1].savings).toBe(12) // (10 - 8) * 6
  })

  it('非容量单位不做换算', () => {
    const rows = deriveSpecRows([
      csku({ id: 'a', name: '原味 100g', unit: 'g', totalQuantity: 100, unitPrice: 0.05 }),
    ])
    expect(rows[0].perUnit).toBe(0.05)
    expect(rows[0].per100).toBe(2000)
  })

  it('单价为 0 时每 100 元可买量兜底为 0', () => {
    const rows = deriveSpecRows([csku({ id: 'a', unitPrice: 0, totalQuantity: 100, unit: 'g' })])
    expect(rows[0].perUnit).toBe(0)
    expect(rows[0].per100).toBe(0)
  })

  // 回归守卫：同价同规格的口味变体必须合并成一行，否则边际效益表会重复列出同规格条目。
  it('同价同规格的口味变体合并为一行', () => {
    const rows = deriveSpecRows([
      csku({ id: 'a', name: '香辣味 38g×8袋', unit: 'g', totalQuantity: 304, unitPrice: 0.0329, price: 10 }),
      csku({ id: 'b', name: '原味 38g×8袋', unit: 'g', totalQuantity: 304, unitPrice: 0.0329, price: 10 }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].fullName).toBe('香辣味/原味 38g×8袋')
  })
})

describe('deriveVisualAnchorId 高亮锚点', () => {
  const rows = deriveSpecRows([
    csku({ id: 'a', unit: 'ml', totalQuantity: 3000, unitPrice: 0.01 }),
    csku({ id: 'b', unit: 'ml', totalQuantity: 6000, unitPrice: 0.008 }),
  ])

  it('命中冠军 id', () => {
    expect(deriveVisualAnchorId(rows, 'b')).toBe('b')
  })

  it('冠军不存在（被合并）→ 退回单价最低的一条', () => {
    expect(deriveVisualAnchorId(rows, 'zzz')).toBe('b')
  })

  // 回归守卫：预算偏好可能把规格全筛掉，此处必须给空串兜底而不是抛错，否则报告页会整页崩。
  it('空数据返回空串', () => {
    expect(deriveVisualAnchorId([], undefined)).toBe('')
  })

  it('空数据即使给了 bestId 也返回空串', () => {
    expect(deriveVisualAnchorId([], 'a')).toBe('')
  })
})

describe('deriveOneLiner 一句话结论', () => {
  const rows = deriveSpecRows([
    csku({ id: 'a', unit: 'ml', totalQuantity: 3000, unitPrice: 0.01 }),
    csku({ id: 'b', unit: 'ml', totalQuantity: 6000, unitPrice: 0.008 }),
  ])

  it('算出每单位省额 / 降幅 / 等量省额', () => {
    const r = deriveOneLiner(rows, 'b')
    expect(r).not.toBeNull()
    expect(r!.anchor.id).toBe('b')
    expect(r!.worst.id).toBe('a')
    expect(r!.savePerUnit).toBe(2)
    expect(r!.pct).toBe(20)
    expect(r!.vsWorst).toBe(12)
  })

  it('不足两档返回 null', () => {
    expect(deriveOneLiner([rows[0]], 'a')).toBeNull()
  })

  it('锚点不存在返回 null', () => {
    expect(deriveOneLiner(rows, 'zzz')).toBeNull()
  })

  it('锚点即最贵一档返回 null', () => {
    expect(deriveOneLiner(rows, 'a')).toBeNull()
  })

  it('锚点单价为 0 返回 null', () => {
    const zero = deriveSpecRows([
      csku({ id: 'z', unitPrice: 0, totalQuantity: 100 }),
      csku({ id: 'y', unitPrice: 0.1, totalQuantity: 100 }),
    ])
    expect(deriveOneLiner(zero, 'z')).toBeNull()
  })
})
