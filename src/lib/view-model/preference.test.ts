import { describe, it, expect } from 'vitest'
import { buildPreferenceHint } from './preference'
import type { ComputedSku, DecisionConfig, ParamDim } from '../types'

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

const dim = (over: Partial<ParamDim> = {}): ParamDim => ({
  id: over.id ?? 'd',
  label: over.label ?? '维度',
  type: over.type ?? 'text',
  weight: over.weight ?? 50,
  ...over,
})

const config = (over: Partial<DecisionConfig> = {}): DecisionConfig => ({
  dims: [],
  priceWeight: 50,
  preference: 'score',
  ...over,
})

const noDiff = '当前清单未配置有差异的参数维度，切换偏好不会改变排名'

describe('buildPreferenceHint 偏好动态提示', () => {
  it('预算优先不提示（过滤语义直观，无需解释）', () => {
    expect(buildPreferenceHint([csku()], config({ preference: 'budget' }), 'budget')).toBeNull()
  })

  it('未配置参数维度 → 说明切换不会改排名', () => {
    expect(buildPreferenceHint([csku(), csku()], config({ dims: [] }), 'value')).toBe(noDiff)
  })

  it('维度取值全相同 → 判定为无差异', () => {
    const dims = [dim({ id: 'a', weight: 30 })]
    const items = [csku({ params: { a: '1' } }), csku({ params: { a: '1' } })]
    expect(buildPreferenceHint(items, config({ dims }), 'value')).toBe(noDiff)
  })

  // 回归守卫：所有规格都没填该维度时不能算「有差异」，否则会给出「参数主导」这种误导提示。
  it('维度取值缺失 → 视为无差异', () => {
    const dims = [dim({ id: 'a' })]
    const items = [csku({ params: {} }), csku({ params: {} })]
    expect(buildPreferenceHint(items, config({ dims }), 'score')).toBe(noDiff)
  })

  it('价格权重明显更高 → 价格主导', () => {
    const dims = [dim({ id: 'a', weight: 20 })]
    const items = [csku({ params: { a: '1' } }), csku({ params: { a: '2' } })]
    expect(buildPreferenceHint(items, config({ dims, priceWeight: 60 }), 'value')).toBe(
      '综合得分 = 价格 60% + 参数 20% 加权（价格主导）',
    )
  })

  it('参数权重明显更高 → 参数主导', () => {
    const dims = [dim({ id: 'a', weight: 100 })]
    const items = [csku({ params: { a: '1' } }), csku({ params: { a: '2' } })]
    expect(buildPreferenceHint(items, config({ dims, priceWeight: 10 }), 'score')).toBe(
      '综合得分 = 价格 10% + 参数 100% 加权（参数主导）',
    )
  })

  it('权重接近 → 价格参数并重', () => {
    const dims = [dim({ id: 'a', weight: 50 })]
    const items = [csku({ params: { a: '1' } }), csku({ params: { a: '2' } })]
    expect(buildPreferenceHint(items, config({ dims, priceWeight: 50 }), 'value')).toBe(
      '综合得分 = 价格 50% + 参数 50% 加权（价格参数并重）',
    )
  })

  it('多维度权重累加', () => {
    const dims = [dim({ id: 'a', weight: 30 }), dim({ id: 'b', weight: 20 })]
    const items = [csku({ params: { a: '1', b: '1' } }), csku({ params: { a: '2', b: '2' } })]
    expect(buildPreferenceHint(items, config({ dims, priceWeight: 50 }), 'score')).toBe(
      '综合得分 = 价格 50% + 参数 50% 加权（价格参数并重）',
    )
  })

  it('负权重被夹到 0，不影响有差异判定', () => {
    const dims = [dim({ id: 'a', weight: -10 })]
    const items = [csku({ params: { a: '1' } }), csku({ params: { a: '2' } })]
    expect(buildPreferenceHint(items, config({ dims, priceWeight: 50 }), 'value')).toBe(
      '综合得分 = 价格 50% + 参数 0% 加权（价格主导）',
    )
  })
})
