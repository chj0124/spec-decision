import { describe, it, expect } from 'vitest'
import { deriveFlavorColorMap, deriveDimColorMaps, deriveDimHasGroup, skusHaveFlavor } from './colors'
import type { ParamDim, Sku } from '../types'

const sku = (over: Partial<Sku> = {}): Sku => ({
  id: over.id ?? 'x',
  name: over.name ?? '测试',
  price: over.price ?? 10,
  quantity: over.quantity ?? 100,
  unit: over.unit ?? 'g',
  packs: over.packs ?? 1,
  ...over,
})

const dim = (over: Partial<ParamDim> = {}): ParamDim => ({
  id: over.id ?? 'd',
  label: over.label ?? '维度',
  type: over.type ?? 'text',
  weight: over.weight ?? 50,
  ...over,
})

describe('deriveFlavorColorMap 口味色映射', () => {
  it('按出现顺序分配颜色，同名口味颜色一致', () => {
    const map = deriveFlavorColorMap(
      [{ name: '香辣味 100g' }, { name: '原味 100g' }, { name: '香辣味 200g' }],
      ['#a', '#b'],
    )
    expect(map.get('香辣味')).toBe('#a')
    expect(map.get('原味')).toBe('#b')
    expect(map.size).toBe(2)
  })

  it('超出调色板长度后循环取色', () => {
    const map = deriveFlavorColorMap([{ name: '甲 1' }, { name: '乙 1' }, { name: '丙 1' }], ['#a', '#b'])
    expect(map.get('甲')).toBe('#a')
    expect(map.get('乙')).toBe('#b')
    expect(map.get('丙')).toBe('#a')
  })

  it('无口味条目被跳过', () => {
    const map = deriveFlavorColorMap([{ name: '500g' }, { name: '原味 500g' }], ['#a'])
    expect(map.has('')).toBe(false)
    expect(map.get('原味')).toBe('#a')
    expect(map.size).toBe(1)
  })
})

describe('deriveDimColorMaps 参数维度色映射', () => {
  it('每个维度独立映射出现过的取值', () => {
    const maps = deriveDimColorMaps(
      [sku({ params: { battery: '4000' } }), sku({ params: { battery: '5000' } })],
      [dim({ id: 'battery' })],
      ['#x', '#y'],
    )
    expect(maps).toHaveLength(1)
    expect(maps[0].get('4000')).toBe('#x')
    expect(maps[0].get('5000')).toBe('#y')
  })

  it('空取值被跳过', () => {
    const maps = deriveDimColorMaps(
      [sku({ params: {} }), sku({ params: { color: '红' } })],
      [dim({ id: 'color' })],
      ['#x'],
    )
    expect(maps[0].size).toBe(1)
    expect(maps[0].get('红')).toBe('#x')
  })

  it('多维各返回一张映射表', () => {
    const maps = deriveDimColorMaps(
      [sku({ params: { a: '1', b: '2' } }), sku({ params: { a: '3', b: '4' } })],
      [dim({ id: 'a' }), dim({ id: 'b' })],
      ['#1', '#2'],
    )
    expect(maps).toHaveLength(2)
    expect(maps[0].get('1')).toBe('#1')
    expect(maps[1].get('4')).toBe('#2')
  })
})

describe('deriveDimHasGroup 维度分组判定', () => {
  it('取值 ≥2 种才算分组', () => {
    expect(
      deriveDimHasGroup([new Map([['a', '#1'], ['b', '#2']]), new Map([['a', '#1']])]),
    ).toEqual([true, false])
  })
})

describe('skusHaveFlavor 口味维度存在性', () => {
  it('存在口味 → true', () => {
    expect(skusHaveFlavor([{ name: '原味 500g' }])).toBe(true)
  })

  it('全无口味 → false', () => {
    expect(skusHaveFlavor([{ name: '500g' }, { name: '1kg' }])).toBe(false)
  })

  it('空列表 → false', () => {
    expect(skusHaveFlavor([])).toBe(false)
  })
})
