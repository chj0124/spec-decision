import { describe, it, expect } from 'vitest'
import { normalizeUnit, isKnownUnit, unitMixWarning, splitByBaseUnit } from './units'
import type { Sku } from '../types'

const sku = (quantity: number, unit: string): Sku => ({
  id: 'x',
  name: '测试',
  price: 10,
  quantity,
  unit,
  packs: 1,
})

describe('normalizeUnit 单位换算表', () => {
  it('重量类换算到 g', () => {
    expect(normalizeUnit(1, 'kg')).toEqual({ value: 1000, base: 'g' })
    expect(normalizeUnit(1, '公斤')).toEqual({ value: 1000, base: 'g' })
    expect(normalizeUnit(500, 'g')).toEqual({ value: 500, base: 'g' })
    expect(normalizeUnit(1, '斤')).toEqual({ value: 500, base: 'g' })
    expect(normalizeUnit(1, '两')).toEqual({ value: 50, base: 'g' })
    expect(normalizeUnit(1, '磅')).toEqual({ value: 453.592, base: 'g' })
    expect(normalizeUnit(1, 'mg')).toEqual({ value: 0.001, base: 'g' })
  })

  it('体积类换算到 ml', () => {
    expect(normalizeUnit(1, 'L')).toEqual({ value: 1000, base: 'ml' })
    expect(normalizeUnit(1, '升')).toEqual({ value: 1000, base: 'ml' })
    expect(normalizeUnit(1, '加仑')).toEqual({ value: 3785.41, base: 'ml' })
    expect(normalizeUnit(500, 'ml')).toEqual({ value: 500, base: 'ml' })
    expect(normalizeUnit(100, 'cc')).toEqual({ value: 100, base: 'ml' })
  })

  it('长度类换算到 cm', () => {
    expect(normalizeUnit(1, 'm')).toEqual({ value: 100, base: 'cm' })
    expect(normalizeUnit(1, 'km')).toEqual({ value: 100000, base: 'cm' })
    expect(normalizeUnit(1, '英寸')).toEqual({ value: 2.54, base: 'cm' })
    expect(normalizeUnit(1, '英尺')).toEqual({ value: 30.48, base: 'cm' })
  })

  it('计件类换算到 个，倍数词按倍数折算', () => {
    expect(normalizeUnit(3, '个')).toEqual({ value: 3, base: '个' })
    expect(normalizeUnit(1, '打')).toEqual({ value: 12, base: '个' })
    expect(normalizeUnit(1, '罗')).toEqual({ value: 144, base: '个' })
    expect(normalizeUnit(1, '令')).toEqual({ value: 500, base: '个' })
  })

  it('大小写不敏感（先原样匹配、再小写匹配）', () => {
    expect(normalizeUnit(1, 'KG')).toEqual({ value: 1000, base: 'g' })
    expect(normalizeUnit(1, 'ML')).toEqual({ value: 1, base: 'ml' })
  })

  it('容器量词（袋/瓶/盒）刻意不入表，原样返回以保留混单位告警能力', () => {
    expect(normalizeUnit(3, '袋')).toEqual({ value: 3, base: '袋' })
    expect(normalizeUnit(6, '瓶')).toEqual({ value: 6, base: '瓶' })
  })

  it('未知单位/空单位原样返回', () => {
    expect(normalizeUnit(5, '')).toEqual({ value: 5, base: '' })
    expect(normalizeUnit(5, '随手写的单位')).toEqual({ value: 5, base: '随手写的单位' })
  })
})

describe('isKnownUnit', () => {
  it('表内单位返回 true', () => {
    expect(isKnownUnit('kg')).toBe(true)
    expect(isKnownUnit('斤')).toBe(true)
    expect(isKnownUnit('L')).toBe(true)
    expect(isKnownUnit('个')).toBe(true)
    expect(isKnownUnit('KG')).toBe(true)
  })

  it('表外单位与空值返回 false', () => {
    expect(isKnownUnit('袋')).toBe(false)
    expect(isKnownUnit('')).toBe(false)
    expect(isKnownUnit('啥也不是')).toBe(false)
  })
})

describe('unitMixWarning 混单位检测', () => {
  it('同量纲（g 与 kg 归一后同为 g）不告警', () => {
    expect(unitMixWarning([sku(100, 'g'), sku(0.5, 'kg')])).toBeNull()
  })

  it('跨量纲（g 与 ml）给出告警文案', () => {
    const w = unitMixWarning([sku(100, 'g'), sku(100, 'ml')])
    expect(w).toBeTypeOf('string')
    expect(w).toContain('g')
    expect(w).toContain('ml')
  })

  it('quantity<=0 的条目被忽略', () => {
    expect(unitMixWarning([sku(0, 'ml'), sku(100, 'g')])).toBeNull()
  })

  it('单个量纲或空列表不告警', () => {
    expect(unitMixWarning([sku(100, 'g'), sku(200, 'g')])).toBeNull()
    expect(unitMixWarning([])).toBeNull()
  })

  it('混量纲时提示已分组分别比价', () => {
    const w = unitMixWarning([sku(100, 'g'), sku(100, 'ml')])
    expect(w).toContain('分组')
  })
})

describe('splitByBaseUnit 量纲分组', () => {
  it('同量纲归一后并为一组（g 与 kg 同组）', () => {
    const groups = splitByBaseUnit([sku(100, 'g'), sku(0.5, 'kg')])
    expect(groups).toHaveLength(1)
    expect(groups[0].base).toBe('g')
    expect(groups[0].skus).toHaveLength(2)
  })

  it('跨量纲拆成多组（g / ml / 个 各一组）', () => {
    const groups = splitByBaseUnit([sku(100, 'g'), sku(500, 'ml'), sku(2, '个'), sku(1, 'L')])
    expect(groups.map((g) => g.base).sort()).toEqual(['g', 'ml', '个'])
    expect(groups.find((g) => g.base === 'ml')?.skus).toHaveLength(2)
  })

  it('quantity<=0 的残项不进任何组；空列表返回空', () => {
    expect(splitByBaseUnit([sku(0, 'ml'), sku(100, 'g')])).toHaveLength(1)
    expect(splitByBaseUnit([])).toEqual([])
  })
})
