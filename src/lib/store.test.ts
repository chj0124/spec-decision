import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  loadWorkspace, exportWorkspace, importWorkspace, saveWorkspace, saveSkus, saveTheme,
  loadTheme, onPersistIssue, getPersistIssue, clearPersistIssues,
} from './store'
import type { PersistIssue, Workspace } from './store'
import type { PricePoint, Sku } from './types'

const SCENARIOS_KEY = 'spec-decision:scenarios'
const THEME_KEY = 'spec-decision:theme'

/** 一天毫秒数：构造"跨天"价格点，避免被同日合并规则吃掉 */
const DAY = 86_400_000

/** 内存版 localStorage：store 在 node 环境下没有 DOM，用最小替身顶上 */
function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size
    },
  }
}

/** 可控制写入失败的 localStorage：按 key 决定是否抛出，用于验证异常上报 */
function flakyStorage(fail: (key: string) => DOMException | null) {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      const err = fail(k)
      if (err) throw err
      map.set(k, String(v))
    },
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size
    },
  }
}

/** 完全不可用的 localStorage：连读都抛（模拟隐私模式 / 第三方存储被拦截） */
function deadStorage() {
  const boom = (): never => {
    throw new DOMException('access denied', 'SecurityError')
  }
  return { getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom }
}

const quotaErr = () => new DOMException('quota exceeded', 'QuotaExceededError')

const emptyWorkspace: Workspace = { scenarios: [], activeId: 'x' }

const sku = (over: Partial<Sku> = {}): Sku => ({
  id: 'a',
  name: '测试规格',
  price: 9.9,
  quantity: 100,
  unit: 'g',
  packs: 1,
  ...over,
})

/** 写入一份"老数据"（不含 priceHistory 的清单） */
function seed(skus: Sku[]) {
  const ws: Workspace = {
    scenarios: [
      {
        id: 's1',
        name: '测试清单',
        skus,
        config: { dims: [], priceWeight: 50, preference: 'value' },
        updatedAt: 1,
      },
    ],
    activeId: 's1',
  }
  localStorage.setItem(SCENARIOS_KEY, JSON.stringify(ws))
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  clearPersistIssues()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loadWorkspace 价格历史迁移', () => {
  it('老数据没有历史：用当前价格播种第一个点，作为后续涨跌的基准', () => {
    seed([sku()])
    const history = loadWorkspace().scenarios[0].skus[0].priceHistory
    expect(history).toHaveLength(1)
    expect(history?.[0].price).toBe(9.9)
  })

  it('价格为 0 的行不播种（不记无意义的 0）', () => {
    seed([sku({ price: 0 })])
    expect(loadWorkspace().scenarios[0].skus[0].priceHistory).toEqual([])
  })

  it('已有历史：清洗后原样保留，不会重复播种', () => {
    seed([sku({ priceHistory: [{ t: 1000, price: 12 }, { t: 1000 + DAY, price: 11 }] })])
    expect(loadWorkspace().scenarios[0].skus[0].priceHistory).toEqual([
      { t: 1000, price: 12 },
      { t: 1000 + DAY, price: 11 },
    ])
  })

  it('非法历史被清洗为空后，重新按当前价格播种', () => {
    seed([sku({ priceHistory: [{ t: 'x', price: 1 }] as unknown as PricePoint[] })])
    const history = loadWorkspace().scenarios[0].skus[0].priceHistory
    expect(history).toHaveLength(1)
    expect(history?.[0].price).toBe(9.9)
  })
})

describe('备份导出 / 导入往返', () => {
  it('价格历史随清单一起往返，不丢失', () => {
    seed([sku({ priceHistory: [{ t: 1000, price: 12 }, { t: 1000 + DAY, price: 11 }] })])
    const restored = importWorkspace(exportWorkspace(loadWorkspace()))
    expect(restored?.scenarios[0].skus[0].priceHistory).toEqual([
      { t: 1000, price: 12 },
      { t: 1000 + DAY, price: 11 },
    ])
  })
})

describe('持久化失败不再静默吞掉', () => {
  it('配额超限：记录失败原因并通知订阅者', () => {
    vi.stubGlobal('localStorage', flakyStorage(() => quotaErr()))
    const seen: Array<PersistIssue | null> = []
    const off = onPersistIssue((i) => seen.push(i))

    saveWorkspace(emptyWorkspace)

    expect(getPersistIssue()).toMatchObject({ key: SCENARIOS_KEY, reason: 'quota' })
    expect(seen).toHaveLength(1)
    off()
  })

  it('存储被禁用：归类为 blocked，且读降级不崩、写被记录', () => {
    vi.stubGlobal('localStorage', deadStorage())

    expect(loadTheme()).toBe('light')
    saveTheme('dark')
    expect(getPersistIssue()).toMatchObject({ key: THEME_KEY, reason: 'blocked' })
  })

  it('后续写入成功即自动消除告警', () => {
    let broken = true
    vi.stubGlobal('localStorage', flakyStorage(() => (broken ? quotaErr() : null)))

    saveWorkspace(emptyWorkspace)
    expect(getPersistIssue()).not.toBeNull()

    broken = false
    saveWorkspace(emptyWorkspace)
    expect(getPersistIssue()).toBeNull()
  })

  it('一个键写成功不会掩盖另一个键的失败', () => {
    vi.stubGlobal('localStorage', flakyStorage((k) => (k === SCENARIOS_KEY ? quotaErr() : null)))

    saveWorkspace(emptyWorkspace)
    expect(getPersistIssue()?.key).toBe(SCENARIOS_KEY)

    saveTheme('dark')
    expect(getPersistIssue()?.key).toBe(SCENARIOS_KEY)
  })

  it('写入失败不留半截数据：旧清单仍可完整读回', () => {
    let broken = false
    vi.stubGlobal(
      'localStorage',
      flakyStorage((k) => (broken && k === SCENARIOS_KEY ? quotaErr() : null)),
    )
    seed([sku({ name: '旧值' })])

    broken = true
    saveWorkspace({ scenarios: [], activeId: 'y' })

    expect(getPersistIssue()?.key).toBe(SCENARIOS_KEY)
    expect(loadWorkspace().scenarios[0].skus[0].name).toBe('旧值')
  })

  it('clearPersistIssues 关闭告警并通知订阅者恢复', () => {
    vi.stubGlobal('localStorage', flakyStorage(() => quotaErr()))
    saveSkus([])

    const seen: Array<PersistIssue | null> = []
    const off = onPersistIssue((i) => seen.push(i))
    clearPersistIssues()

    expect(getPersistIssue()).toBeNull()
    expect(seen).toEqual([null])
    off()
  })

  it('取消订阅后不再收到回调', () => {
    vi.stubGlobal('localStorage', flakyStorage(() => quotaErr()))
    let calls = 0
    const off = onPersistIssue(() => {
      calls += 1
    })
    off()

    saveSkus([])
    expect(calls).toBe(0)
  })
})
