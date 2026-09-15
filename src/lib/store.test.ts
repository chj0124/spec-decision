import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { loadWorkspace, exportWorkspace, importWorkspace } from './store'
import type { Workspace } from './store'
import type { PricePoint, Sku } from './types'

const SCENARIOS_KEY = 'spec-decision:scenarios'

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
