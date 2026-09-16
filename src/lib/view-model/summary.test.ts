import { describe, it, expect } from 'vitest'
import { buildSummaryText } from './summary'
import type { ComputedSku, DecisionConfig, DecisionResult, MarginInsight } from '../types'

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

const margin = (verdict: string): MarginInsight => ({
  fromId: 'from',
  toId: 'to',
  fromName: 'from',
  toName: 'to',
  extraCost: 0,
  extraQuantity: 0,
  unit: 'g',
  unitPriceDropPct: 0,
  marginalSaving: 0,
  netSaving: 0,
  grade: 'good',
  worthIt: true,
  verdict,
})

const config = (over: Partial<DecisionConfig> = {}): DecisionConfig => ({
  dims: [],
  priceWeight: 50,
  preference: 'score',
  ...over,
})

const result = (over: Partial<DecisionResult> = {}): DecisionResult => ({
  items: [],
  best: null,
  baseline: null,
  margins: [],
  warnings: [],
  warningPairs: [],
  warningNotes: [],
  reasons: [],
  clusters: [],
  hasVariants: false,
  budgetExcludedItems: [],
  ...over,
})

const best = csku({
  id: 'best',
  name: '原味 500ml×6瓶',
  price: 30,
  unit: 'ml',
  totalQuantity: 3000,
  unitPrice: 0.01,
  score: 88.3,
  rank: 1,
  isBest: true,
})

describe('buildSummaryText 决策摘要', () => {
  it('无最佳推荐 → 空串', () => {
    expect(buildSummaryText(result(), config())).toBe('')
  })

  it('包含标题、冠军、完整排名与页脚', () => {
    const text = buildSummaryText(result({ best, items: [best] }), config())
    expect(text).toContain('【规格决策摘要】')
    expect(text).toContain('★ 最划算：原味 500ml×6瓶')
    expect(text).toContain('总量 3L')
    expect(text).toContain('每L ¥10.00')
    expect(text).toContain('综合得分 88.3')
    expect(text).toContain('完整排名（前 5 / 共 1 项）：')
    expect(text).toContain('— 由「规格决策台」生成')
  })

  it('有商品类型时写入该行', () => {
    const text = buildSummaryText(result({ best, items: [best] }), config({ category: '零食' }))
    expect(text).toContain('商品类型：零食')
  })

  it('无商品类型时不写该行', () => {
    const text = buildSummaryText(result({ best, items: [best] }), config())
    expect(text).not.toContain('商品类型')
  })

  // 摘要会被粘贴到别处，脱离页面后看不出数据新旧，因此过期提示必须写进正文。
  it('价格记录过期时显式标注', () => {
    const stale = csku({ ...best, priceHistory: [{ t: Date.now() - 40 * 86_400_000, price: 30 }] })
    const text = buildSummaryText(result({ best: stale, items: [stale] }), config())
    expect(text).toContain('价格记录：')
    expect(text).toContain('已超过 30 天未更新，结论可能过期')
  })

  it('推荐理由 / 边际效益 / 避坑提示按段落输出', () => {
    const text = buildSummaryText(
      result({
        best,
        items: [best],
        reasons: ['价格最低', '量大更划算'],
        margins: [margin('升级划算')],
        warnings: ['注意囤货'],
      }),
      config(),
    )
    expect(text).toContain('推荐理由：')
    expect(text).toContain('1. 价格最低')
    expect(text).toContain('2. 量大更划算')
    expect(text).toContain('边际效益：')
    expect(text).toContain('· 升级划算')
    expect(text).toContain('避坑提示：')
    expect(text).toContain('· 注意囤货')
  })

  it('预算偏好下列出被排除的规格及超出金额', () => {
    const excl = csku({ id: 'e', name: '原味 1L装', price: 60 })
    const text = buildSummaryText(
      result({ best, items: [best], budgetExcludedItems: [excl] }),
      config({ preference: 'budget', budget: 50 }),
    )
    expect(text).toContain('因超预算未纳入比较（预算 ¥50.00')
    expect(text).toContain('原味 1L装 — 总价 ¥60.00，超 ¥10.00')
  })

  it('非预算偏好即使有排除项也不写预算段', () => {
    const excl = csku({ id: 'e', name: '原味 1L装', price: 60 })
    const text = buildSummaryText(
      result({ best, items: [best], budgetExcludedItems: [excl] }),
      config({ budget: 50 }),
    )
    expect(text).not.toContain('因超预算未纳入比较')
  })

  it('排名最多取前 5 项', () => {
    const many = Array.from({ length: 7 }, (_, i) => csku({ id: `i${i}`, name: `项${i}`, rank: i + 1 }))
    const text = buildSummaryText(result({ best, items: many }), config())
    expect(text).toContain('前 5 / 共 7 项')
    expect(text).toContain('5. 项4')
    expect(text).not.toContain('6. 项5')
  })
})
