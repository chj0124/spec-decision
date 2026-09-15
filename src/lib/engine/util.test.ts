import { describe, it, expect } from 'vitest'
import { fmt, isStale, STALE_DAYS } from './util'

const DAY = 86_400_000
/** 固定"现在"，避免用例依赖真实时钟导致跨天/跨时区抖动 */
const now = new Date(2026, 5, 15, 12, 0, 0).getTime()

describe('fmt.ago 相对时间', () => {
  it('一分钟内说“刚刚”', () => {
    expect(fmt.ago(now, now)).toBe('刚刚')
    expect(fmt.ago(now - 1, now)).toBe('刚刚')
    expect(fmt.ago(now - 59_000, now)).toBe('刚刚')
  })

  it('满一分钟起按分钟', () => {
    expect(fmt.ago(now - 60_000, now)).toBe('1 分钟前')
    expect(fmt.ago(now - 59 * 60_000, now)).toBe('59 分钟前')
  })

  it('满一小时起按小时', () => {
    expect(fmt.ago(now - 60 * 60_000, now)).toBe('1 小时前')
    expect(fmt.ago(now - 23 * 60 * 60_000, now)).toBe('23 小时前')
  })

  it('满一天起按天', () => {
    expect(fmt.ago(now - DAY, now)).toBe('1 天前')
    expect(fmt.ago(now - 29 * DAY, now)).toBe('29 天前')
  })

  // 超过门槛后"N 天前"读不出具体时间点，必须换成绝对日期
  it('超过 30 天改用绝对日期', () => {
    expect(fmt.ago(now - 30 * DAY, now)).toBe('2026/5/16')
    expect(fmt.ago(now - 100 * DAY, now)).toBe('2026/3/7')
  })

  it('非法或缺失的时间戳返回“时间未知”而不是乱算', () => {
    expect(fmt.ago(0, now)).toBe('时间未知')
    expect(fmt.ago(-1, now)).toBe('时间未知')
    expect(fmt.ago(NaN, now)).toBe('时间未知')
  })
})

describe('isStale 数据新鲜度判定', () => {
  it('没有价格记录时不算过期（无时间戳不该报警）', () => {
    expect(isStale(undefined, now)).toBe(false)
  })

  it('无效时间戳不算过期', () => {
    expect(isStale(0, now)).toBe(false)
    expect(isStale(NaN, now)).toBe(false)
  })

  it('刚好等于门槛不算过期，超过门槛 1 毫秒才算', () => {
    expect(isStale(now - STALE_DAYS * DAY, now)).toBe(false)
    expect(isStale(now - STALE_DAYS * DAY - 1, now)).toBe(true)
  })

  it('刚录入的价格不算过期', () => {
    expect(isStale(now - 1, now)).toBe(false)
  })

  it('未来时间戳不算过期（时钟偏差不该触发告警）', () => {
    expect(isStale(now + DAY, now)).toBe(false)
  })
})
