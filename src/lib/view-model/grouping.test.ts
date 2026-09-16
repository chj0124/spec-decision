import { describe, it, expect } from 'vitest'
import { groupComputedSkus, deriveGroupOptions } from './grouping'
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

describe('groupComputedSkus 计算后 SKU 分组', () => {
  it('按口味分组，无口味归入「（无{flavorLabel}）」', () => {
    const groups = groupComputedSkus(
      [
        csku({ name: '香辣味 100g' }),
        csku({ name: '香辣味 200g' }),
        csku({ name: '原味 100g' }),
        csku({ name: '500g' }),
      ],
      'flavor',
      '口味',
    )
    expect(groups.find((g) => g.key === '香辣味')?.items).toHaveLength(2)
    expect(groups.find((g) => g.key === '原味')?.items).toHaveLength(1)
    expect(groups.find((g) => g.key === '（无口味）')?.items).toHaveLength(1)
  })

  it('按单件含量分组，key 为「数值+单位」', () => {
    const groups = groupComputedSkus(
      [csku({ quantity: 100, unit: 'g' }), csku({ quantity: 200, unit: 'g' })],
      'quantity',
      '口味',
    )
    expect(groups.map((g) => g.key)).toEqual(['100g', '200g'])
  })

  it('按件数分组，key 为「N件」', () => {
    const groups = groupComputedSkus(
      [csku({ packs: 1 }), csku({ packs: 4 }), csku({ packs: 4 })],
      'packs',
      '口味',
    )
    expect(groups.find((g) => g.key === '4件')?.items).toHaveLength(2)
  })

  // 回归守卫：分组必须保留派生字段（packPrice 等），否则折叠后再展开会丢「每包价」。
  it('保留派生字段', () => {
    const groups = groupComputedSkus([csku({ packPrice: 3 })], 'packs', '口味')
    expect(groups[0].items[0].packPrice).toBe(3)
  })
})

describe('deriveGroupOptions 分组维度候选', () => {
  it('少于 3 项不提供分组', () => {
    expect(
      deriveGroupOptions([csku({ name: '香辣味 100g' }), csku({ name: '原味 100g' })], '口味'),
    ).toEqual([])
  })

  it('只保留有区分度（≥2 种）且非全异（<项数）的维度', () => {
    const opts = deriveGroupOptions(
      [
        csku({ name: '香辣味 100g', quantity: 100, unit: 'g' }),
        csku({ name: '香辣味 200g', quantity: 200, unit: 'g' }),
        csku({ name: '原味 100g', quantity: 100, unit: 'g' }),
      ],
      '口味',
    )
    expect(opts.map((o) => o.key)).toEqual(['flavor', 'quantity'])
    expect(opts.map((o) => o.label)).toEqual(['按口味', '按单件含量'])
  })

  it('取值全相同 / 每项都不同的维度被过滤掉', () => {
    const opts = deriveGroupOptions(
      [
        csku({ name: '香辣味 100g', quantity: 100, unit: 'g' }),
        csku({ name: '香辣味 200g', quantity: 200, unit: 'g' }),
        csku({ name: '香辣味 300g', quantity: 300, unit: 'g' }),
      ],
      '口味',
    )
    expect(opts).toEqual([])
  })

  it('flavorLabel 自定义体现在标签上', () => {
    const opts = deriveGroupOptions(
      [
        csku({ name: 'A 100g', quantity: 100, unit: 'g' }),
        csku({ name: 'A 200g', quantity: 200, unit: 'g' }),
        csku({ name: 'B 100g', quantity: 100, unit: 'g' }),
      ],
      '型号',
    )
    expect(opts.find((o) => o.key === 'flavor')?.label).toBe('按型号')
  })
})
