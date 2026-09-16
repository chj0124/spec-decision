import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  loadWorkspace, exportWorkspace, importWorkspace, saveWorkspace, saveSkus, saveTheme,
  loadTheme, onPersistIssue, getPersistIssue, clearPersistIssues,
  createWorkspaceSync,
} from './store'
import type { PersistIssue, Scenario, Workspace } from './store'
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

const emptyWorkspace: Workspace = { scenarios: [], activeId: 'x', rev: 0 }

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
    rev: 0,
  }
  localStorage.setItem(SCENARIOS_KEY, JSON.stringify(ws))
}

/** 列出当前 localStorage 中的所有键（memoryStorage 只暴露 key(i) / length） */
function listKeys(): string[] {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k) keys.push(k)
  }
  return keys.sort()
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
    saveWorkspace({ scenarios: [], activeId: 'y', rev: 0 })

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

describe('saveWorkspace 只写主数据键（A10：删除 active-scenario 僵尸键）', () => {
  it('写入后 localStorage 键集合只有主数据键，不再有只写不读的 active-scenario', () => {
    saveWorkspace({ scenarios: [], activeId: 'x', rev: 0 })

    expect(listKeys()).toEqual([SCENARIOS_KEY])
    expect(listKeys()).not.toContain('spec-decision:active-scenario')
  })
})

describe('loadWorkspace 遇脏数据不覆盖原键（A11）', () => {
  const CORRUPT_KEY = 'spec-decision:corrupt-backup'

  it('JSON 解析失败：降级为可用工作区，原键保持不动并备份原文', () => {
    const broken = '{ 这不是合法 JSON'
    localStorage.setItem(SCENARIOS_KEY, broken)

    const ws = loadWorkspace()

    expect(ws.scenarios.length).toBeGreaterThan(0)
    expect(localStorage.getItem(SCENARIOS_KEY)).toBe(broken)
    expect(localStorage.getItem(CORRUPT_KEY)).toBe(broken)
  })

  it('结构不可用（scenarios 为空）：同样备份且不覆盖', () => {
    const raw = JSON.stringify({ scenarios: [], activeId: 'x', rev: 0 })
    localStorage.setItem(SCENARIOS_KEY, raw)

    const ws = loadWorkspace()

    expect(ws.scenarios.length).toBeGreaterThan(0)
    expect(localStorage.getItem(SCENARIOS_KEY)).toBe(raw)
    expect(localStorage.getItem(CORRUPT_KEY)).toBe(raw)
  })

  it('数据正常：纯读取，不改动原键也不产生备份', () => {
    seed([sku({ name: '正常值' })])
    const before = localStorage.getItem(SCENARIOS_KEY)

    expect(loadWorkspace().scenarios[0].skus[0].name).toBe('正常值')
    expect(localStorage.getItem(SCENARIOS_KEY)).toBe(before)
    expect(localStorage.getItem(CORRUPT_KEY)).toBeNull()
  })

  it('首次使用（键不存在）：显式迁移并落盘', () => {
    const ws = loadWorkspace()

    expect(ws.scenarios.length).toBe(1)
    expect(listKeys()).toEqual([SCENARIOS_KEY])
  })
})

describe('多标签页一致性（B1）：并发写不静默丢失', () => {
  /** 造一份单清单工作区（未清洗的原始形状，仅用于落盘） */
  const rawWs = (skus: Sku[], rev = 0): Workspace => ({
    scenarios: [
      { id: 's1', name: '清单', skus, config: { dims: [], priceWeight: 50, preference: 'value' }, updatedAt: 1 },
    ],
    activeId: 's1',
    rev,
  })

  /** 落盘一份原始数据再读回，得到与真实运行时一致（已清洗、含 priceHistory）的 base */
  const baseWorkspace = (skus: Sku[], rev = 0): Workspace => {
    localStorage.setItem(SCENARIOS_KEY, JSON.stringify(rawWs(skus, rev)))
    return loadWorkspace()
  }

  /** 从 base 派生本页工作区：沿用 base 里原样的 SKU 对象，只替换/追加给定的那份列表 */
  const withSkus = (base: Workspace, skus: Sku[]): Workspace => ({
    ...base,
    scenarios: [{ ...base.scenarios[0], skus, updatedAt: base.scenarios[0].updatedAt + 1 }],
  })

  /** 让两个同步器共享同一份"存储"，模拟两个标签页各自持有同一个 base 快照 */
  function twoTabs(base: Workspace) {
    localStorage.setItem(SCENARIOS_KEY, JSON.stringify(base))
    const tabA = createWorkspaceSync()
    const tabB = createWorkspaceSync()
    tabA.prime(base)
    tabB.prime(base)
    return { tabA, tabB }
  }

  it('两个标签页各加一个 SKU：合并后两个都在，无静默丢失', async () => {
    const base = baseWorkspace([sku({ id: 'A' })])
    const { tabA, tabB } = twoTabs(base)
    const a0 = base.scenarios[0].skus[0]

    // A 先落盘（rev 0 → 1）
    const a = await tabA.save(withSkus(base, [a0, sku({ id: 'C' })]))
    expect(a.status).toBe('saved')

    // B 落后于存储：绝不整份覆盖，合并后落盘
    const b = await tabB.save(withSkus(base, [a0, sku({ id: 'B' })]))
    expect(b.status).toBe('merged')

    const stored = loadWorkspace()
    expect(stored.scenarios[0].skus.map((s) => s.id).sort()).toEqual(['A', 'B', 'C'])
    expect(stored.rev).toBe(2)
  })

  it('同一 SKU 两边都改：以存储中较新的那版为准，且不会复制成两条', async () => {
    const base = baseWorkspace([sku({ id: 'A', name: '原始' })])
    const { tabA, tabB } = twoTabs(base)
    const a0 = base.scenarios[0].skus[0]

    await tabA.save(withSkus(base, [{ ...a0, name: 'A改' }]))
    const b = await tabB.save(withSkus(base, [{ ...a0, price: 22, name: 'B改' }]))
    expect(b.status).toBe('merged')

    const skus = loadWorkspace().scenarios[0].skus
    expect(skus).toHaveLength(1)
    expect(skus[0].name).toBe('A改')
  })

  it('两个标签页各建一份清单：合并后两份都在', async () => {
    const base = baseWorkspace([sku({ id: 'A' })])
    const { tabA, tabB } = twoTabs(base)
    const s1 = base.scenarios[0]

    const mk = (id: string, name: string, skuId: string): Scenario => ({
      id, name, skus: [sku({ id: skuId })], config: s1.config, updatedAt: 2,
    })
    await tabA.save({ scenarios: [s1, mk('s2', 'A 建的', 'X')], activeId: 's2', rev: 0 })
    const b = await tabB.save({ scenarios: [s1, mk('s3', 'B 建的', 'Y')], activeId: 's3', rev: 0 })
    expect(b.status).toBe('merged')

    expect(loadWorkspace().scenarios.map((s) => s.id).sort()).toEqual(['s1', 's2', 's3'])
  })

  it('本页的删除不被别处旧快照"复活"', async () => {
    const base = baseWorkspace([sku({ id: 'A' }), sku({ id: 'B' })])
    const { tabA, tabB } = twoTabs(base)
    const [a0, b0] = base.scenarios[0].skus

    // A 删掉 B 并落盘；B 页基于旧 base（仍含 B）只改了 A 的名字
    await tabA.save(withSkus(base, [a0]))
    const b = await tabB.save(withSkus(base, [{ ...a0, name: 'A改' }, b0]))
    expect(b.status).toBe('merged')

    const skus = loadWorkspace().scenarios[0].skus
    expect(skus.map((s) => s.id)).toEqual(['A'])
    expect(skus[0].name).toBe('A改')
  })

  it('无并发：连续保存 rev 单调递增，不误判为冲突', async () => {
    const base = baseWorkspace([sku({ id: 'A' })])
    const sync = createWorkspaceSync()
    sync.prime(base)

    const a = base.scenarios[0].skus[0]
    const r1 = await sync.save(withSkus(base, [a, sku({ id: 'B' })]))
    expect(r1.status).toBe('saved')
    expect(r1.workspace.rev).toBe(1)

    const r2 = await sync.save(withSkus(base, [...r1.workspace.scenarios[0].skus, sku({ id: 'C' })]))
    expect(r2.status).toBe('saved')
    expect(r2.workspace.rev).toBe(2)
  })

  it('内容没变就不推进 rev：打开标签页本身不算"外部变更"', async () => {
    const base = baseWorkspace([sku({ id: 'A' })], 7)
    const sync = createWorkspaceSync()
    sync.prime(base)

    const r = await sync.save(base)

    expect(r.status).toBe('saved')
    expect(r.workspace.rev).toBe(7)
    expect(loadWorkspace().rev).toBe(7)
  })

  it('落盘失败：返回 failed 并上报持久化异常', async () => {
    vi.stubGlobal('localStorage', flakyStorage(() => quotaErr()))
    const sync = createWorkspaceSync()
    sync.prime(rawWs([sku({ id: 'A' })]))

    const r = await sync.save(rawWs([sku({ id: 'A' })]))

    expect(r.status).toBe('failed')
    expect(getPersistIssue()?.key).toBe(SCENARIOS_KEY)
  })
})
