import { describe, it, expect } from 'vitest'
import { clusterItems, rankByPreference } from './clusters'
import { computeSku } from './scoring'
import type { Sku } from '../types'

const sku = (over: Partial<Sku> = {}): Sku => ({
  id: over.id ?? 'x',
  name: over.name ?? '测试',
  price: over.price ?? 10,
  quantity: over.quantity ?? 100,
  unit: over.unit ?? 'g',
  packs: over.packs ?? 1,
  ...over,
})

describe('clusterItems 同款分簇', () => {
  it('quantity/packs/unit 相同 → 归为一簇，簇内按单价挑代表', () => {
    const clusters = clusterItems([
      computeSku(sku({ id: 'a', price: 30 })),
      computeSku(sku({ id: 'b', price: 10 })),
      computeSku(sku({ id: 'c', price: 20 })),
    ])
    expect(clusters).toHaveLength(1)
    expect(clusters[0].members).toHaveLength(3)
    expect(clusters[0].minPrice).toBe(10)
    expect(clusters[0].maxPrice).toBe(30)
    expect(clusters[0].priceSpread).toBe(20)
    // 簇内最省钱者作为决策代表
    expect(clusters[0].members[0].id).toBe('b')
  })

  it('参数签名不同 → 不合并成一簇（避免掩盖真实规格差异）', () => {
    const clusters = clusterItems([
      computeSku(sku({ id: 'a', price: 10, params: { ram: 8 } })),
      computeSku(sku({ id: 'b', price: 10, params: { ram: 12 } })),
    ])
    expect(clusters).toHaveLength(2)
  })

  it('20 万成员的单簇求 min/max/score 不抛 RangeError（A9：Math.max(...arr) 会栈溢出）', () => {
    const size = 200_000
    const members = Array.from({ length: size }, (_, i) =>
      computeSku(sku({ id: `s${i}`, price: 10 + i })),
    )
    const clusters = clusterItems(members)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].members).toHaveLength(size)
    expect(clusters[0].minPrice).toBe(10)
    expect(clusters[0].maxPrice).toBe(10 + size - 1)
  })
})

describe('rankByPreference 按偏好排序', () => {
  it('性价比优先按单价升序，综合得分优先按分数降序', () => {
    const items = [
      { ...computeSku(sku({ id: 'a' })), score: 60, unitPrice: 0.3 },
      { ...computeSku(sku({ id: 'b' })), score: 90, unitPrice: 0.5 },
    ]
    expect(rankByPreference(items, 'value').map((i) => i.id)).toEqual(['a', 'b'])
    expect(rankByPreference(items, 'score').map((i) => i.id)).toEqual(['b', 'a'])
  })

  it('预算优先会先剔除超预算项，再按分数排序', () => {
    const items = [
      { ...computeSku(sku({ id: 'a', price: 300 })), score: 99 },
      { ...computeSku(sku({ id: 'b', price: 50 })), score: 10 },
    ]
    const ranked = rankByPreference(items, 'budget', 100)
    expect(ranked.map((i) => i.id)).toEqual(['b'])
    expect(ranked[0].isBest).toBe(true)
  })
})
