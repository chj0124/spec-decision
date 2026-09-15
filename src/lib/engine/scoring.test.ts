import { describe, it, expect } from 'vitest'
import {
  computeSku,
  scoreItems,
  marginAnalysis,
  mergeVariantSkus,
  buildWarnings,
} from './scoring'
import { decide } from './decide'
import { rankByPreference } from './clusters'
import type { DecisionConfig, ParamDim, Sku } from '../types'

const sku = (over: Partial<Sku> = {}): Sku => ({
  id: over.id ?? 'x',
  name: over.name ?? '测试',
  price: over.price ?? 10,
  quantity: over.quantity ?? 100,
  unit: over.unit ?? 'g',
  packs: over.packs ?? 1,
  ...over,
})

const cfg = (over: Partial<DecisionConfig> = {}): DecisionConfig => ({
  dims: over.dims ?? [],
  priceWeight: over.priceWeight ?? 50,
  preference: over.preference ?? 'score',
  ...(over.budget !== undefined ? { budget: over.budget } : {}),
})

describe('computeSku 派生值', () => {
  it('总量 = 单件基准量 × 件数，单价 = 总价 / 总量', () => {
    const c = computeSku(sku({ price: 20, quantity: 100, unit: 'g', packs: 2 }))
    expect(c.totalQuantity).toBe(200)
    expect(c.unitPrice).toBe(0.1)
    expect(c.packPrice).toBe(10)
  })

  it('单件单位先归一化到基准单位（0.1kg × 2 件 = 200g）', () => {
    const c = computeSku(sku({ price: 20, quantity: 0.1, unit: 'kg', packs: 2 }))
    expect(c.unit).toBe('g')
    expect(c.totalQuantity).toBe(200)
    expect(c.unitPrice).toBe(0.1)
  })

  it('packs 为 0 时兜底为 1，避免除零', () => {
    const c = computeSku(sku({ price: 10, quantity: 100, unit: 'g', packs: 0 }))
    expect(c.packPrice).toBe(10)
    expect(c.unitPrice).toBe(0.1)
  })
})

describe('scoreItems 多维加权评分', () => {
  it('同规格下单价越低价格分越高（0-100）', () => {
    const a = computeSku(sku({ id: 'a', price: 10, quantity: 100, packs: 1 }))
    const b = computeSku(sku({ id: 'b', price: 20, quantity: 100, packs: 1 }))
    const [sa, sb] = scoreItems([a, b], cfg({ priceWeight: 50 }))
    expect(sa.score).toBe(100)
    expect(sb.score).toBe(0)
    expect(sa.dimScores?.price).toBe(100)
  })

  it('higher-better 维度：数值越高得分越高', () => {
    const dim: ParamDim = { id: 'battery', label: '电池', type: 'higher-better', weight: 50 }
    const low = computeSku(sku({ id: 'low', price: 10, params: { battery: 4000 } }))
    const high = computeSku(sku({ id: 'high', price: 10, params: { battery: 5000 } }))
    const [sLow, sHigh] = scoreItems([low, high], cfg({ dims: [dim], priceWeight: 50 }))
    expect(sHigh.score).toBeGreaterThan(sLow.score)
    expect(sHigh.dimScores?.battery).toBe(100)
    expect(sLow.dimScores?.battery).toBe(0)
  })

  it('lower-better 维度：数值越低得分越高', () => {
    const dim: ParamDim = { id: 'weight', label: '重量', type: 'lower-better', weight: 50 }
    const light = computeSku(sku({ id: 'light', price: 10, params: { weight: 100 } }))
    const heavy = computeSku(sku({ id: 'heavy', price: 10, params: { weight: 200 } }))
    const [sLight, sHeavy] = scoreItems([light, heavy], cfg({ dims: [dim] }))
    expect(sLight.score).toBeGreaterThan(sHeavy.score)
  })

  it('空列表原样返回', () => {
    expect(scoreItems([], cfg())).toEqual([])
  })
})

describe('marginAnalysis 相邻档位边际效益', () => {
  const small = computeSku(sku({ id: 's', name: '原味 100g×1袋', price: 10, quantity: 100, packs: 1 }))
  const large = computeSku(sku({ id: 'l', name: '原味 100g×4袋', price: 15, quantity: 100, packs: 4 }))

  it('单价大幅下降 → grade=great 且 worthIt', () => {
    const [m] = marginAnalysis([small, large])
    expect(m.extraCost).toBe(5)
    expect(m.extraQuantity).toBe(300)
    expect(m.unitPriceDropPct).toBeCloseTo(62.5, 1)
    expect(m.grade).toBe('great')
    expect(m.worthIt).toBe(true)
  })

  it('单价基本持平 → grade=fair', () => {
    const flat = computeSku(sku({ id: 'f', name: '原味 100g×2袋', price: 20, quantity: 100, packs: 2 }))
    const [m] = marginAnalysis([small, flat])
    expect(m.grade).toBe('fair')
    expect(m.worthIt).toBe(false)
  })

  it('单价明显上涨 → grade=bad', () => {
    const worse = computeSku(sku({ id: 'w', name: '原味 100g×2袋', price: 30, quantity: 100, packs: 2 }))
    const [m] = marginAnalysis([small, worse])
    expect(m.grade).toBe('bad')
  })

  it('少于两个规格 → 空数组', () => {
    expect(marginAnalysis([small])).toEqual([])
    expect(marginAnalysis([])).toEqual([])
  })
})

describe('mergeVariantSkus 同款合并', () => {
  it('同价同量同单位、仅口味不同 → 合并为一条', () => {
    const a = computeSku(sku({ id: 'a', name: '香辣味 100g×1袋', price: 10, quantity: 100, packs: 1 }))
    const b = computeSku(sku({ id: 'b', name: '原味 100g×1袋', price: 10, quantity: 100, packs: 1 }))
    const merged = mergeVariantSkus([a, b])
    expect(merged).toHaveLength(1)
    expect(merged[0].name).toContain('100g×1袋')
  })

  it('合并后不足两条 → marginAnalysis 无边际结论', () => {
    const a = computeSku(sku({ id: 'a', name: '香辣味 100g×1袋', price: 10, quantity: 100, packs: 1 }))
    const b = computeSku(sku({ id: 'b', name: '原味 100g×1袋', price: 10, quantity: 100, packs: 1 }))
    expect(marginAnalysis(mergeVariantSkus([a, b]))).toEqual([])
  })

  it('价格不同则不合并', () => {
    const a = computeSku(sku({ id: 'a', name: '香辣味 100g×1袋', price: 10, quantity: 100, packs: 1 }))
    const b = computeSku(sku({ id: 'b', name: '原味 100g×1袋', price: 12, quantity: 100, packs: 1 }))
    expect(mergeVariantSkus([a, b])).toHaveLength(2)
  })
})

describe('rankByPreference 偏好排序', () => {
  const cheap = computeSku(sku({ id: 'cheap', price: 10, quantity: 100, packs: 1 })) // 0.1/g
  const bulk = computeSku(sku({ id: 'bulk', price: 15, quantity: 100, packs: 4 })) // 0.0375/g

  it("preference='value' 按单价升序", () => {
    const r = rankByPreference([cheap, bulk], 'value')
    expect(r[0].id).toBe('bulk')
    expect(r[0].rank).toBe(1)
    expect(r[0].isBest).toBe(true)
  })

  it("preference='budget' 过滤超预算项", () => {
    const r = rankByPreference([cheap, bulk], 'budget', 12)
    expect(r).toHaveLength(1)
    expect(r[0].id).toBe('cheap')
  })
})

describe('decide 主入口', () => {
  it('过滤掉 price/quantity/packs <= 0 的无效行', () => {
    const valid = sku({ id: 'ok', price: 10, quantity: 100, packs: 1 })
    const noPrice = sku({ id: 'nop', price: 0, quantity: 100, packs: 1 })
    const noQty = sku({ id: 'noq', price: 10, quantity: 0, packs: 1 })
    const noPacks = sku({ id: 'nopk', price: 10, quantity: 100, packs: 0 })
    const r = decide([valid, noPrice, noQty, noPacks], cfg())
    expect(r.items).toHaveLength(1)
    expect(r.items[0].id).toBe('ok')
  })

  it("preference='value' 时 best 为单价最低者", () => {
    const a = sku({ id: 'a', price: 10, quantity: 100, packs: 1 })
    const b = sku({ id: 'b', price: 15, quantity: 100, packs: 4 })
    const r = decide([a, b], cfg({ preference: 'value', priceWeight: 100 }))
    expect(r.best?.id).toBe('b')
  })

  it("preference='budget' 统计被预算过滤掉的规格数", () => {
    const a = sku({ id: 'a', price: 10, quantity: 100, packs: 1 })
    const b = sku({ id: 'b', price: 20, quantity: 100, packs: 1 })
    const r = decide([a, b], cfg({ preference: 'budget', budget: 12 }))
    expect(r.budgetExcluded).toBe(1)
    expect(r.best?.id).toBe('a')
  })

  it('空输入返回空结果而非抛错', () => {
    const r = decide([], cfg())
    expect(r.items).toEqual([])
    expect(r.best).toBeNull()
    expect(r.reasons).toEqual([])
  })

  it('同定价多口味 → hasVariants 为 true', () => {
    const a = sku({ id: 'a', name: '香辣味 100g×1袋', price: 10, quantity: 100, packs: 1 })
    const b = sku({ id: 'b', name: '原味 100g×1袋', price: 10, quantity: 100, packs: 1 })
    const r = decide([a, b], cfg())
    expect(r.hasVariants).toBe(true)
    expect(r.clusters).toHaveLength(1)
  })
})

describe('buildWarnings 避坑提示', () => {
  it('单条规格时无提示', () => {
    expect(buildWarnings([computeSku(sku())])).toEqual([])
  })

  it('单价差距悬殊时给出提示', () => {
    const cheap = computeSku(sku({ id: 'c', name: '白菜', price: 10, quantity: 100, packs: 1 }))
    const pricey = computeSku(sku({ id: 'p', name: '刺客', price: 50, quantity: 100, packs: 1 }))
    const tips = buildWarnings([cheap, pricey])
    expect(tips.join('')).toContain('刺客')
  })
})
