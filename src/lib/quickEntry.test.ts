import { describe, it, expect } from 'vitest'
import type { Sku } from './types'
import {
  parseQuickLine,
  parseQuickEntry,
  quickEntryToSku,
  quickEntryUnitPrice,
  type QuickEntryItem,
} from './quickEntry'

/**
 * 用例基准是真实场景：无糖芬达的三种规格（拼多多商品页）。
 *   300ml*12瓶*2箱  ¥27.91（原价 ¥34.9）
 *   500ml*24瓶      ¥49.7 （已优惠 13.3 元）
 *   888ml*12        ¥34.4 （已优惠 8 元）
 * 三者总含量 7200ml / 12000ml / 10656ml，
 * 每 ml 价格 0.003876 / 0.004142 / 0.003228 元 —— 888ml 最划算、500ml 最贵。
 */
const FANTA_LINES = ['300ml*12瓶*2箱 27.91', '500ml*24瓶 49.7', '888ml*12 34.4'].join('\n')

describe('parseQuickLine 单行极速录入', () => {
  it('规格 + 价格：复合件数连乘、量词按单位补全', () => {
    expect(parseQuickLine('300ml*12瓶*2箱 27.91')).toEqual({
      raw: '300ml*12瓶*2箱 27.91',
      name: '300ml×24瓶',
      price: 27.91,
      quantity: 300,
      unit: 'ml',
      packs: 24,
      packUnit: '瓶',
      ok: true,
    })
  })

  it('整段商品标题：自动挑出规格与价格（截图标题直贴）', () => {
    const item = parseQuickLine(
      '【3095人好评】可口可乐无糖芬达饮料 300ml*12瓶*2箱 橙味迷你碳酸饮料 27.91',
    )
    expect(item.ok).toBe(true)
    expect(item.name).toBe('300ml×24瓶')
    expect(item.price).toBe(27.91)
    expect(item.packs).toBe(24)
  })

  it('券后价与已优惠金额混排：取货币符号后的第一个（券后价）', () => {
    const item = parseQuickLine('券后¥49.7 已优惠13.3元 可乐无糖芬达 500ml*24瓶 零卡橙味整箱包邮')
    expect(item.price).toBe(49.7)
    expect(item.quantity).toBe(500)
    expect(item.packs).toBe(24)
    expect(item.name).toBe('500ml×24瓶')
  })

  it('带原价时取最左的券后价', () => {
    expect(parseQuickLine('¥27.91 ¥34.9 300ml*12瓶*2箱').price).toBe(27.91)
  })

  it('无件数的规格（888ml*12）按单位补「瓶」', () => {
    const item = parseQuickLine('888ml*12')
    expect(item).toEqual({
      raw: '888ml*12',
      name: '888ml×12瓶',
      price: 0,
      quantity: 888,
      unit: 'ml',
      packs: 12,
      ok: true,
      note: '没找到价格，先按 0 记，可在表格里补',
    })
  })

  it('统一口味会加到每条名称前面', () => {
    expect(parseQuickLine('500ml*24瓶 49.7', '橙味').name).toBe('橙味 500ml×24瓶')
  })

  it('只有价格没有规格 → 不成行，且不会把「元」当单位', () => {
    const item = parseQuickLine('券后49.7元')
    expect(item.ok).toBe(false)
    expect(item.note).toContain('没找到规格')
  })

  it('纯文字行 → 不成行', () => {
    expect(parseQuickLine('可口可乐无糖芬达').ok).toBe(false)
  })
})

describe('parseQuickEntry 多行批量', () => {
  const items = parseQuickEntry(`${FANTA_LINES}\n\n`)

  it('跳过空行，逐行成行', () => {
    expect(items).toHaveLength(3)
    expect(items.every((i) => i.ok)).toBe(true)
    expect(items.map((i) => i.price)).toEqual([27.91, 49.7, 34.4])
    expect(items.map((i) => i.quantity * i.packs)).toEqual([7200, 12000, 10656])
  })

  it('每单位价排序：888ml 最划算、500ml 最贵', () => {
    const sorted = [...items].sort((a, b) => quickEntryUnitPrice(a) - quickEntryUnitPrice(b))
    expect(sorted[0].price).toBe(34.4)
    expect(sorted[1].price).toBe(27.91)
    expect(sorted[2].price).toBe(49.7)
  })
})

describe('quickEntryToSku', () => {
  const item: QuickEntryItem = parseQuickEntry(FANTA_LINES)[0]

  it('转成可入表的 SKU，字段与 id 齐备', () => {
    const sku: Sku = quickEntryToSku(item)
    expect(sku.id).toBeTruthy()
    expect(sku.name).toBe('300ml×24瓶')
    expect(sku.price).toBe(27.91)
    expect(sku.quantity).toBe(300)
    expect(sku.unit).toBe('ml')
    expect(sku.packs).toBe(24)
    expect(sku.packUnit).toBe('瓶')
  })

  it('每行生成独立 id，避免多行互相覆盖', () => {
    const skus = parseQuickEntry(FANTA_LINES).map(quickEntryToSku)
    expect(new Set(skus.map((s) => s.id)).size).toBe(3)
  })
})
