import { describe, it, expect } from 'vitest'
import {
  parseFlavor,
  parseSpec,
  buildSpec,
  buildName,
  stripFlavorCategory,
  isContentUnit,
  normalizePackUnit,
  groupSkus,
} from './spec'
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

describe('parseFlavor 口味拆分', () => {
  it('半角空格分隔：取首词为口味', () => {
    expect(parseFlavor('香辣味 16g×8袋')).toEqual({ flavor: '香辣味', spec: '16g×8袋' })
  })

  // 回归守卫：全角空格（\u3000）在中文录入里同样常见，
  // 历史上此正则漏写全角空格字符，曾被 ESLint no-irregular-whitespace 捕获。
  it('全角空格分隔同样生效', () => {
    expect(parseFlavor('原味\u3000500ml×6瓶')).toEqual({ flavor: '原味', spec: '500ml×6瓶' })
  })

  it('无空格：整体视为规格、口味留空', () => {
    expect(parseFlavor('500ml×6瓶')).toEqual({ flavor: '', spec: '500ml×6瓶' })
  })

  it('空字符串返回空对象', () => {
    expect(parseFlavor('')).toEqual({ flavor: '', spec: '' })
    expect(parseFlavor('   ')).toEqual({ flavor: '', spec: '' })
  })
})

describe('parseSpec 规格描述 → 结构化字段', () => {
  it('主模式：数字+单位 × 数字+量词', () => {
    expect(parseSpec('38g×20袋')).toEqual({ quantity: 38, unit: 'g', packs: 20, packUnit: '袋' })
    expect(parseSpec('500ml×6瓶')).toEqual({ quantity: 500, unit: 'ml', packs: 6, packUnit: '瓶' })
  })

  it('支持 * / x / X 分隔符且不写量词', () => {
    expect(parseSpec('16g*8')).toEqual({ quantity: 16, unit: 'g', packs: 8 })
    expect(parseSpec('16gx8')).toMatchObject({ quantity: 16, unit: 'g', packs: 8 })
  })

  it('缺件数时退化为「数字+单位」', () => {
    expect(parseSpec('200g')).toMatchObject({ quantity: 200, unit: 'g' })
  })

  // 回归守卫：电商整箱规格常写成 "12瓶*2箱"，必须连乘。
  // 曾经只取最后一组，300ml*12瓶*2箱 被当成 12 瓶，7200ml 算成 3600ml，比价结论直接反了。
  it('复合件数连乘，量词取最内层', () => {
    expect(parseSpec('300ml*12瓶*2箱')).toEqual({
      quantity: 300,
      unit: 'ml',
      packs: 24,
      packUnit: '瓶',
    })
    expect(parseSpec('500ml*6瓶*4箱')).toMatchObject({ packs: 24, packUnit: '瓶' })
  })

  it('空字符串返回空对象', () => {
    expect(parseSpec('')).toEqual({})
  })
})

describe('buildSpec 结构化字段 → 规格描述', () => {
  it('拼出标准描述', () => {
    expect(buildSpec(38, 'g', 20, '袋')).toBe('38g×20袋')
    expect(buildSpec(500, 'ml', 6, '瓶')).toBe('500ml×6瓶')
  })

  it('缺省 packUnit 回退为「袋」', () => {
    expect(buildSpec(38, 'g', 20)).toBe('38g×20袋')
  })

  // 回归守卫：液量单位下回退「瓶」而不是「袋」，否则饮料会被拼成 "500ml×24袋"
  it('液量单位缺省 packUnit 回退为「瓶」', () => {
    expect(buildSpec(500, 'ml', 24)).toBe('500ml×24瓶')
    expect(buildSpec(888, 'ml', 12)).toBe('888ml×12瓶')
    expect(buildSpec(1.5, 'L', 6)).toBe('1.5L×6瓶')
  })

  it('显式 packUnit 优先于单位推断', () => {
    expect(buildSpec(500, 'ml', 24, '箱')).toBe('500ml×24箱')
  })

  it('packs<=0 兜底为 1', () => {
    expect(buildSpec(38, 'g', 0)).toBe('38g×1袋')
  })

  it('quantity<=0 返回空串', () => {
    expect(buildSpec(0, 'g', 20)).toBe('')
  })

  it('与 parseSpec 往返一致', () => {
    const spec = buildSpec(38, 'g', 20, '袋')
    expect(parseSpec(spec)).toEqual({ quantity: 38, unit: 'g', packs: 20, packUnit: '袋' })
  })
})

describe('groupSkus 分组折叠', () => {
  it('按口味分组', () => {
    const groups = groupSkus(
      [sku({ name: '香辣味 100g' }), sku({ name: '香辣味 200g' }), sku({ name: '原味 100g' })],
      'flavor',
    )
    expect(groups).toHaveLength(2)
    expect(groups.find((g) => g.key === '香辣味')?.items).toHaveLength(2)
    expect(groups.find((g) => g.key === '原味')?.items).toHaveLength(1)
  })

  it('按件数分组', () => {
    const groups = groupSkus([sku({ packs: 1 }), sku({ packs: 4 }), sku({ packs: 4 })], 'packs')
    expect(groups.find((g) => g.key === '4件')?.items).toHaveLength(2)
  })
})

describe('stripFlavorCategory 口味首词剥离品类词', () => {
  // 回归守卫：AI 常把品类词拼进口味首词（"橙味汽水"），
  // 导致同口味的规格被拆成多组、口味列被污染成半个商品名。
  it('剥离尾部品类词', () => {
    expect(stripFlavorCategory('橙味汽水')).toBe('橙味')
    expect(stripFlavorCategory('柠檬味饮料')).toBe('柠檬味')
    expect(stripFlavorCategory('葡萄味气泡水')).toBe('葡萄味')
  })

  it('真实口味/无后缀词原样返回', () => {
    expect(stripFlavorCategory('香辣味')).toBe('香辣味')
    expect(stripFlavorCategory('芬达')).toBe('芬达')
    expect(stripFlavorCategory('原味')).toBe('原味')
  })

  it('剥离后不得为空，纯品类词保留', () => {
    expect(stripFlavorCategory('汽水')).toBe('汽水')
    expect(stripFlavorCategory('可乐')).toBe('可乐')
  })

  it('首尾空白不敏感', () => {
    expect(stripFlavorCategory('  橙味汽水  ')).toBe('橙味')
  })
})

describe('isContentUnit 含量型单位判定', () => {
  it('质量 / 体积单位判为含量型', () => {
    expect(isContentUnit('g')).toBe(true)
    expect(isContentUnit('ml')).toBe(true)
    expect(isContentUnit('L')).toBe(true)
    expect(isContentUnit('毫升')).toBe(true)
  })

  it('大小写与空白不敏感', () => {
    expect(isContentUnit('ML')).toBe(true)
    expect(isContentUnit(' ml ')).toBe(true)
  })

  // 回归守卫：手机（个/GB）、螺丝（mm）、纸巾（抽）不能套用「含量×件数」写法，
  // 否则 "M4×10mm" 会被误改成 "4×10袋"。
  it('非含量型单位不为真', () => {
    expect(isContentUnit('个')).toBe(false)
    expect(isContentUnit('mm')).toBe(false)
    expect(isContentUnit('抽')).toBe(false)
    expect(isContentUnit('GB')).toBe(false)
  })
})

describe('normalizePackUnit 件数量词归一', () => {
  it('批量/外箱量词丢弃，交给单位回退', () => {
    expect(normalizePackUnit('箱')).toBeUndefined()
    expect(normalizePackUnit('件')).toBeUndefined()
    expect(normalizePackUnit('提')).toBeUndefined()
  })

  it('最小可比量词保留', () => {
    expect(normalizePackUnit('瓶')).toBe('瓶')
    expect(normalizePackUnit('袋')).toBe('袋')
  })

  it('空值返回 undefined', () => {
    expect(normalizePackUnit()).toBeUndefined()
    expect(normalizePackUnit('')).toBeUndefined()
  })
})

describe('buildName 规范名称重建', () => {
  it('口味 + 规格，全角 ×', () => {
    expect(buildName('橙味', 300, 'ml', 24, '瓶')).toBe('橙味 300ml×24瓶')
  })

  it('缺省 packUnit 按单位回退', () => {
    expect(buildName('橙味', 300, 'ml', 24)).toBe('橙味 300ml×24瓶')
    expect(buildName('香辣味', 38, 'g', 20)).toBe('香辣味 38g×20袋')
  })

  it('口味为空时只输出规格', () => {
    expect(buildName('', 500, 'ml', 6, '瓶')).toBe('500ml×6瓶')
  })

  it('与 parseFlavor / parseSpec 往返一致', () => {
    const name = buildName('混装', 888, 'ml', 12, '瓶')
    expect(parseFlavor(name)).toEqual({ flavor: '混装', spec: '888ml×12瓶' })
    expect(parseSpec(name)).toEqual({ quantity: 888, unit: 'ml', packs: 12, packUnit: '瓶' })
  })
})
