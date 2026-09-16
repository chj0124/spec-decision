import { describe, it, expect } from 'vitest'
import {
  MAX_PRICE_POINTS,
  recordPrice,
  sanitizePriceHistory,
  priceTrend,
  priceStats,
  fmtPointDay,
} from './history'
import type { PricePoint } from '../types'

/** 用本地时间构造时间戳，与 sameDay 的"本地日历日"判定保持一致 */
const at = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h).getTime()

describe('recordPrice 价格记录追加', () => {
  it('首次录入生成一个点', () => {
    expect(recordPrice(undefined, 9.9, at(2026, 1, 5))).toEqual([
      { t: at(2026, 1, 5), price: 9.9 },
    ])
  })

  // 清空价格输入框会得到 0，这种中间态不该进历史
  it('非正价格不入历史', () => {
    expect(recordPrice(undefined, 0, at(2026, 1, 5))).toEqual([])
    expect(recordPrice(undefined, -3, at(2026, 1, 5))).toEqual([])
  })

  it('同一天内改价覆盖当天记录，不新增点（避免逐字符输入刷屏）', () => {
    const history: PricePoint[] = [{ t: at(2026, 1, 5, 9), price: 10 }]
    const next = recordPrice(history, 12, at(2026, 1, 5, 15))
    expect(next).toEqual([{ t: at(2026, 1, 5, 15), price: 12 }])
  })

  it('价格与最后一条相同：返回原数组引用，调用方可跳过写入', () => {
    const history: PricePoint[] = [{ t: at(2026, 1, 5), price: 10 }]
    expect(recordPrice(history, 10, at(2026, 1, 9))).toBe(history)
  })

  it('跨天改价追加新点，保留历史', () => {
    const history: PricePoint[] = [{ t: at(2026, 1, 5), price: 10 }]
    const next = recordPrice(history, 8, at(2026, 1, 6))
    expect(next).toEqual([
      { t: at(2026, 1, 5), price: 10 },
      { t: at(2026, 1, 6), price: 8 },
    ])
  })

  it('超过上限时丢弃最旧的点', () => {
    const history: PricePoint[] = Array.from({ length: MAX_PRICE_POINTS }, (_, i) => ({
      t: at(2026, 1, i + 1),
      price: 10 + i,
    }))
    const next = recordPrice(history, 99, at(2026, 2, 1))
    expect(next).toHaveLength(MAX_PRICE_POINTS)
    expect(next[next.length - 1]).toEqual({ t: at(2026, 2, 1), price: 99 })
    expect(next[0].t).toBe(history[1].t) // 最旧的一条被挤掉
  })
})

describe('sanitizePriceHistory 外部数据清洗', () => {
  it('非数组返回空', () => {
    expect(sanitizePriceHistory(undefined)).toEqual([])
    expect(sanitizePriceHistory('x')).toEqual([])
    expect(sanitizePriceHistory({ t: 1, price: 2 })).toEqual([])
  })

  it('丢弃非法点并按时间升序', () => {
    const raw = [
      { t: at(2026, 1, 7), price: 8 },
      { t: 'bad', price: 5 },
      { t: at(2026, 1, 5), price: 10 },
      { t: at(2026, 1, 6), price: 0 },
      null,
    ]
    expect(sanitizePriceHistory(raw)).toEqual([
      { t: at(2026, 1, 5), price: 10 },
      { t: at(2026, 1, 7), price: 8 },
    ])
  })

  it('同一天多条合并为当天最后一条', () => {
    const raw = [
      { t: at(2026, 1, 5, 9), price: 10 },
      { t: at(2026, 1, 5, 18), price: 9 },
      { t: at(2026, 1, 6, 9), price: 11 },
    ]
    expect(sanitizePriceHistory(raw)).toEqual([
      { t: at(2026, 1, 5, 18), price: 9 },
      { t: at(2026, 1, 6, 9), price: 11 },
    ])
  })

  it('超长序列截断到上限', () => {
    const raw = Array.from({ length: MAX_PRICE_POINTS + 5 }, (_, i) => ({
      t: at(2026, 1, i + 1),
      price: 10,
    }))
    expect(sanitizePriceHistory(raw)).toHaveLength(MAX_PRICE_POINTS)
  })
})

describe('priceTrend 走势汇总', () => {
  it('不足两个点返回 null（没有可比对象就别提示）', () => {
    expect(priceTrend(undefined)).toBeNull()
    expect(priceTrend([])).toBeNull()
    expect(priceTrend([{ t: at(2026, 1, 5), price: 10 }])).toBeNull()
  })

  it('涨价：方向 up，正百分比', () => {
    const trend = priceTrend([
      { t: at(2026, 1, 5), price: 10 },
      { t: at(2026, 1, 8), price: 11 },
    ])
    expect(trend).toMatchObject({ direction: 'up', first: 10, last: 11, delta: 1, deltaPct: 10 })
  })

  it('降价：方向 down，负百分比的绝对值体现', () => {
    const trend = priceTrend([
      { t: at(2026, 1, 5), price: 10 },
      { t: at(2026, 1, 8), price: 8 },
    ])
    expect(trend).toMatchObject({ direction: 'down', delta: -2, deltaPct: -20 })
  })

  it('回到原点：首尾相同判为持平', () => {
    const trend = priceTrend([
      { t: at(2026, 1, 5), price: 10 },
      { t: at(2026, 1, 6), price: 7 },
      { t: at(2026, 1, 7), price: 10 },
    ])
    expect(trend?.direction).toBe('flat')
    expect(trend?.deltaPct).toBe(0)
  })

  it('过滤掉非法点后再判断', () => {
    expect(priceTrend([{ t: at(2026, 1, 5), price: 0 }, { t: at(2026, 1, 6), price: 5 }])).toBeNull()
  })
})

describe('priceStats 价格位置统计', () => {
  it('没有有效点返回 null（无历史就谈不上"贵/便宜"）', () => {
    expect(priceStats(undefined)).toBeNull()
    expect(priceStats([])).toBeNull()
    expect(priceStats([{ t: at(2026, 1, 5), price: 0 }])).toBeNull()
  })

  it('只有一个点：最低=最高=均价=当前价，分位 100 且判定为历史最低', () => {
    const stats = priceStats([{ t: at(2026, 1, 5), price: 9 }])
    expect(stats).toMatchObject({
      current: 9,
      min: 9,
      max: 9,
      avg: 9,
      percentile: 100,
      isLowest: true,
      vsAvgPct: 0,
    })
  })

  it('当前价即历史最低：isLowest、分位 100、相对均价为负', () => {
    const stats = priceStats([
      { t: at(2026, 1, 5), price: 12 },
      { t: at(2026, 1, 6), price: 10 },
      { t: at(2026, 1, 7), price: 8 },
    ])
    expect(stats).toMatchObject({
      current: 8,
      min: 8,
      max: 12,
      avg: 10,
      percentile: 100,
      isLowest: true,
      vsAvgPct: -20,
    })
  })

  it('当前价高于均价：不是最低、分位偏低、相对均价为正', () => {
    const stats = priceStats([
      { t: at(2026, 1, 5), price: 10 },
      { t: at(2026, 1, 6), price: 8 },
      { t: at(2026, 1, 7), price: 12 },
    ])
    expect(stats).toMatchObject({
      current: 12,
      min: 8,
      max: 12,
      avg: 10,
      percentile: 33,
      isLowest: false,
      vsAvgPct: 20,
    })
  })

  it('过滤非法点后再统计（0/NaN 不参与最低均价）', () => {
    const stats = priceStats([
      { t: at(2026, 1, 5), price: 0 },
      { t: at(2026, 1, 6), price: 5 },
    ])
    expect(stats).toMatchObject({ current: 5, min: 5, max: 5, avg: 5, isLowest: true })
  })
})

describe('fmtPointDay', () => {
  it('输出 M/D 短日期', () => {
    expect(fmtPointDay(at(2026, 1, 5))).toBe('1/5')
    expect(fmtPointDay(at(2026, 12, 31))).toBe('12/31')
  })
})
