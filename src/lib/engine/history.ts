/**
 * 价格历史：追踪同一规格历次录入的总价，用于提示「涨价 / 降价」。
 *
 * 数据量刻意做小 —— 只回答「最近价格有没有变」，不做完整价格曲线归档：
 *  - 同一天内重复录入合并为一条，避免逐字符输入刷出一串中间值
 *  - 全序列截断到 MAX_PRICE_POINTS 条，最旧的先丢
 */
import type { PricePoint } from '../types'
import { round, minOf, maxOf } from './util'

/** 单个规格最多保留的历史点数（超出丢弃最旧） */
export const MAX_PRICE_POINTS = 30

const sameDay = (a: number, b: number) => {
  const da = new Date(a)
  const db = new Date(b)
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  )
}

/**
 * 清洗外部来源（localStorage / 备份文件）的价格历史：
 * 丢弃非法的点、按时间升序、同日合并、截断上限。
 */
export function sanitizePriceHistory(raw: unknown): PricePoint[] {
  if (!Array.isArray(raw)) return []
  const points: PricePoint[] = []
  for (const item of raw as Array<Partial<PricePoint> | null | undefined>) {
    const t = Number(item?.t)
    const price = Number(item?.price)
    if (Number.isFinite(t) && price > 0) points.push({ t, price })
  }
  points.sort((a, b) => a.t - b.t)

  const merged: PricePoint[] = []
  for (const p of points) {
    const last = merged[merged.length - 1]
    if (last && sameDay(last.t, p.t)) merged[merged.length - 1] = p
    else merged.push(p)
  }
  return merged.slice(-MAX_PRICE_POINTS)
}

/**
 * 追加一次录入，返回新的历史数组。
 * 返回原数组引用表示「无需变更」，调用方可据此跳过 state 写入：
 *  - 价格非正数：忽略（清空输入框产生的 0 不该进历史）
 *  - 与最后一条价格相同：忽略
 *  - 与最后一条同一天：覆盖该条（打字过程中的中间值不留痕）
 */
export function recordPrice(history: PricePoint[] | undefined, price: number, now = Date.now()): PricePoint[] {
  const points = history ?? []
  if (!(price > 0)) return points
  const last = points[points.length - 1]
  if (!last) return [{ t: now, price }]
  if (last.price === price) return points
  if (sameDay(last.t, now)) return [...points.slice(0, -1), { t: now, price }]
  return [...points, { t: now, price }].slice(-MAX_PRICE_POINTS)
}

export interface PriceTrend {
  points: PricePoint[]
  first: number
  last: number
  delta: number // 最后一次 - 第一次（元），正=涨价
  deltaPct: number // 相对首次的百分比
  direction: 'up' | 'down' | 'flat'
}

/** 汇总走势；少于 2 条记录（还没有可比对象）时返回 null，调用方据此不渲染任何提示 */
export function priceTrend(history: PricePoint[] | undefined): PriceTrend | null {
  const points = (history ?? []).filter((p) => p && p.price > 0)
  if (points.length < 2) return null
  const first = points[0].price
  const last = points[points.length - 1].price
  const delta = round(last - first)
  return {
    points,
    first,
    last,
    delta,
    deltaPct: first > 0 ? round((delta / first) * 100, 1) : 0,
    direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
  }
}

export interface PriceStats {
  points: PricePoint[]
  /** 当前价（序列最后一条，即最近一次录入） */
  current: number
  min: number
  max: number
  avg: number
  /** 历史价格中 ≥ 当前价的比例（0-100）：越高说明现在买越划算 */
  percentile: number
  /** 当前价即历史最低（含持平） */
  isLowest: boolean
  /** 当前价相对均价的百分比（正=高于均价，负=低于均价） */
  vsAvgPct: number
}

/**
 * 价格位置统计：回答"现在这个价，在历史里算什么位置"。
 * 纯计算，无 IO；没有有效点时返回 null，调用方据此不渲染任何位置提示。
 */
export function priceStats(history: PricePoint[] | undefined): PriceStats | null {
  const points = (history ?? []).filter((p) => p && p.price > 0)
  if (points.length === 0) return null
  const prices = points.map((p) => p.price)
  const current = prices[prices.length - 1]
  const min = minOf(prices)
  const avg = round(prices.reduce((sum, p) => sum + p, 0) / prices.length)
  return {
    points,
    current,
    min,
    max: maxOf(prices),
    avg,
    percentile: round((prices.filter((p) => p >= current).length / prices.length) * 100, 0),
    isLowest: current <= min,
    vsAvgPct: avg > 0 ? round(((current - avg) / avg) * 100, 1) : 0,
  }
}

/** 价格点时间戳 → "M/D"，用于 tooltip/文案里简短标注日期 */
export function fmtPointDay(t: number): string {
  const d = new Date(t)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
