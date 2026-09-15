import { describe, it, expect } from 'vitest'
import { parseItems } from './recognize'

const item = (over: Record<string, unknown> = {}) => ({
  name: '橙味汽水 300ml*12瓶*2箱',
  price: 39.9,
  quantity: 300,
  unit: 'ml',
  packs: 12,
  ...over,
})

describe('parseItems 识别结果规格归一', () => {
  // 回归守卫：识别输出曾出现三类硬错误——
  // 口味列混入品类词、规格列错位、整箱件数没连乘，直接导致比价口径错误。
  it('剥离口味首词的品类词并重建规范名称', () => {
    const [sku] = parseItems([item()], [])
    expect(sku.name).toBe('橙味 300ml×24瓶')
    expect(sku.quantity).toBe(300)
    expect(sku.unit).toBe('ml')
    expect(sku.packUnit).toBe('瓶')
  })

  it('件数改用规格串的连乘结果（覆盖 AI 漏乘）', () => {
    const [sku] = parseItems([item({ packs: 12 })], [])
    expect(sku.packs).toBe(24)
  })

  it('真实口味（非品类词）原样保留', () => {
    const [sku] = parseItems([item({ name: '芬达 888ml*12瓶' })], [])
    expect(sku.name).toBe('芬达 888ml×12瓶')
    expect(sku.packs).toBe(12)
  })

  it('外箱量词丢弃，回退到最小可比量词', () => {
    const [sku] = parseItems([item({ name: '混装 888ml×12箱' })], [])
    expect(sku.name).toBe('混装 888ml×12瓶')
    expect(sku.packUnit).toBeUndefined()
  })

  // 回归守卫：非含量型商品（螺丝 M4×10mm、手机 个/GB）不得套用「含量×件数」重建，
  // 否则规格会被改写成语义错误的写法。
  it('非含量型单位不改名、不动字段', () => {
    const [sku] = parseItems(
      [item({ name: 'M4×10mm', unit: 'mm', quantity: 4, packs: 10 })],
      [],
    )
    expect(sku.name).toBe('M4×10mm')
    expect(sku.quantity).toBe(4)
    expect(sku.packs).toBe(10)
  })

  it('过滤掉缺名或非正价的脏项', () => {
    const skus = parseItems(
      [item({ name: '' }), item({ price: 0 }), item({ price: -1 })],
      [],
    )
    expect(skus).toHaveLength(0)
  })

  it('仅保留已知维度的 params', () => {
    const dims = [{ label: '口味', type: 'text' as const }]
    const [sku] = parseItems([item({ params: { 口味: '橙味', 瞎编字段: 'x' } })], dims)
    expect(sku.params).toEqual({ 口味: '橙味' })
  })

  it('非数组输入返回空数组', () => {
    expect(parseItems(null, [])).toEqual([])
    expect(parseItems('x', [])).toEqual([])
  })
})
