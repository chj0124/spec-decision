import { describe, it, expect } from 'vitest'
import { shortSpec, packWord, listPackWord, splitWarnText, wrapCjk } from './text'
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

describe('shortSpec 轴标签短名', () => {
  it('口味 + 短规格 → 「口味·规格」', () => {
    expect(shortSpec('香辣味 16g×8袋')).toBe('香辣味·16g×8袋')
  })

  it('无口味但规格较短 → 直接用规格', () => {
    expect(shortSpec('500ml×6瓶')).toBe('500ml×6瓶')
  })

  // 回归守卫：规格超过 12 字符时不能把「口味·规格」整串塞进轴标签，否则图表轴被撑爆；
  // 此时退回按原名的字符截断，保证标签宽度可控。
  it('规格过长 → 退回截断原名', () => {
    expect(shortSpec('abcdefghijklmnop')).toBe('abcdefghijkl…')
  })
})

describe('packWord 单条每件量词', () => {
  it('显式量词优先', () => {
    expect(packWord(4, '瓶')).toBe('瓶')
    expect(packWord(1, '瓶')).toBe('瓶')
  })

  it('无显式量词时按件数回退：多件「包」、单件「件」', () => {
    expect(packWord(4)).toBe('包')
    expect(packWord(1)).toBe('件')
  })

  it('空量词也走回退', () => {
    expect(packWord(4, '')).toBe('包')
    expect(packWord(1, '')).toBe('件')
  })
})

describe('listPackWord 列表级每件量词', () => {
  it('取列表里实际出现过的量词', () => {
    expect(listPackWord([csku({ packUnit: '瓶' }), csku({ packs: 4 })])).toBe('瓶')
  })

  it('无量词时：有多件「包」、全单件「件」', () => {
    expect(listPackWord([csku({ packs: 4 }), csku({ packs: 1 })])).toBe('包')
    expect(listPackWord([csku({ packs: 1 })])).toBe('件')
  })

  it('空列表回退「件」', () => {
    expect(listPackWord([])).toBe('件')
  })
})

describe('splitWarnText 避坑提示拆行', () => {
  it('在首个逗号处断成「结论 + 细节」，结论去掉句读', () => {
    expect(splitWarnText('结论，细节。')).toEqual({ lead: '结论', detail: '细节。' })
  })

  it('无逗号 → 整段作结论、细节留空，并剥掉尾句号', () => {
    expect(splitWarnText('无逗号结论。')).toEqual({ lead: '无逗号结论', detail: '' })
  })

  it('多个逗号只在第一个处断，细节保留后续逗号', () => {
    expect(splitWarnText('带，逗号，多处。')).toEqual({ lead: '带', detail: '逗号，多处。' })
  })
})

describe('wrapCjk SVG 文字手工折行', () => {
  it('CJK 各记 1 个字宽，超宽即断行', () => {
    expect(wrapCjk('中文测试', 3)).toEqual(['中文测', '试'])
  })

  it('ASCII 各记 0.55，窄串不折行', () => {
    expect(wrapCjk('abc', 10)).toEqual(['abc'])
  })

  it('ASCII 超宽按累计宽度断行', () => {
    expect(wrapCjk('abcdefg', 3)).toEqual(['abcde', 'fg'])
  })

  it('空串返回空数组', () => {
    expect(wrapCjk('', 5)).toEqual([])
  })
})
