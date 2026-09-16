import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  loadWorkspace, exportWorkspace, importWorkspace, saveWorkspace, saveSkus, saveTheme,
  loadTheme, onPersistIssue, getPersistIssue, clearPersistIssues,
  commitWorkspace, readStoredRev, subscribeWorkspaceChange,
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
    const raw = JSON.stringify({ scenarios: [], activeId: 'x' })
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

/* ---------- 多标签页一致性（B1） ---------- */

/** 可手动触发事件的 window 替身：捕获 store 注册的 storage 监听 */
function fakeWindow() {
  const handlers = new Map<string, Set<(e: unknown) => void>>()
  return {
    addEventListener(type: string, h: (e: unknown) => void) {
      if (!handlers.has(type)) handlers.set(type, new Set())
      handlers.get(type)?.add(h)
    },
    removeEventListener(type: string, h: (e: unknown) => void) {
      handlers.get(type)?.delete(h)
    },
    emit(type: string, event: unknown) {
      handlers.get(type)?.forEach((h) => h(event))
    },
    listenerCount: (type: string) => handlers.get(type)?.size ?? 0,
  }
}

/** BroadcastChannel 替身：记录实例与广播内容，并支持模拟"另一个标签页"发来的消息 */
function fakeBroadcastChannel() {
  const instances: FakeChannel[] = []
  class FakeChannel {
    closed = false
    sent: Array<{ rev: number; from: string }> = []
    private listeners = new Set<(e: { data: unknown }) => void>()
    constructor(readonly name: string) {
      instances.push(this)
    }
    addEventListener(_type: string, h: (e: { data: unknown }) => void) {
      this.listeners.add(h)
    }
    removeEventListener(_type: string, h: (e: { data: unknown }) => void) {
      this.listeners.delete(h)
    }
    postMessage(data: { rev: number; from: string }) {
      this.sent.push(data)
    }
    close() {
      this.closed = true
    }
    /** 模拟其他标签页广播到本频道 */
    receive(data: unknown) {
      this.listeners.forEach((h) => h({ data }))
    }
  }
  return { FakeChannel, instances }
}

describe('多标签页一致性（B1）', () => {
  const sc = (name: string): Scenario => ({
    id: name,
    name,
    skus: [],
    config: { dims: [], priceWeight: 50, preference: 'value' },
    updatedAt: 1,
  })
  const wsOf = (rev: number, ...names: string[]): Workspace => ({
    scenarios: names.map(sc),
    activeId: names[0] ?? '',
    rev,
  })

  it('readStoredRev：无数据为 0；提交后回落到落盘版本号', async () => {
    expect(readStoredRev()).toBe(0)

    const res = await commitWorkspace(wsOf(0, 'a'))

    expect(res).toMatchObject({ ok: true, rev: 1, skipped: false })
    expect(readStoredRev()).toBe(1)
  })

  it('内容未变不重复写：避免 rev 回写触发的重跑把版本号推高', async () => {
    const ws = wsOf(0, 'a')
    await commitWorkspace(ws)

    const again = await commitWorkspace({ ...ws, rev: 1 })

    expect(again).toMatchObject({ ok: true, rev: 1, skipped: true })
    expect(readStoredRev()).toBe(1)
  })

  it('落盘写规范化形态：补齐 priceHistory 后同一份内容不再反复写入', async () => {
    // 生成示例等路径给出的 SKU 没有 priceHistory，清洗会按当前价播种一个点
    const generated: Workspace = {
      scenarios: [{ ...sc('默认清单'), skus: [sku({ id: 'k1', price: 12 })] }],
      activeId: '默认清单',
      rev: 0,
    }

    const first = await commitWorkspace(generated)
    expect(first).toMatchObject({ ok: true, rev: 1, skipped: false })

    const stored = JSON.parse(localStorage.getItem(SCENARIOS_KEY) as string)
    expect(stored.scenarios[0].skus[0].priceHistory).toHaveLength(1)

    // 调用方采用回传的规范化工作区后，再次提交应直接跳过、rev 不涨
    const second = await commitWorkspace(first.ok ? first.workspace : generated)
    expect(second).toMatchObject({ ok: true, rev: 1, skipped: true })
    expect(readStoredRev()).toBe(1)
  })

  it('读回来的形态与落盘一致：第二个标签页挂载不会无谓写入、推高 rev（B1 回归）', async () => {
    const generated: Workspace = {
      scenarios: [{ ...sc('默认清单'), skus: [sku({ id: 'k1', price: 12 })] }],
      activeId: '默认清单',
      rev: 0,
    }
    const first = await commitWorkspace(generated)
    expect(first).toMatchObject({ ok: true, rev: 1, skipped: false })

    // 模拟另一个标签页挂载：从落盘读回来（经清洗）后立刻提交
    const loaded = loadWorkspace()
    const res = await commitWorkspace(loaded)

    expect(res).toMatchObject({ ok: true, rev: 1, skipped: true })
    expect(readStoredRev()).toBe(1)
  })

  it('第二个写入者领先时：本地过期提交被拒绝，且不覆盖对方数据', async () => {
    localStorage.setItem(SCENARIOS_KEY, JSON.stringify(wsOf(5, '远端')))

    const res = await commitWorkspace(wsOf(2, '本地'))

    expect(res).toEqual({ ok: false, reason: 'stale', rev: 5 })
    const stored = JSON.parse(localStorage.getItem(SCENARIOS_KEY) as string)
    expect(stored.rev).toBe(5)
    expect(stored.scenarios[0].name).toBe('远端')
  })

  it('同标签页连续提交不算过期：内存 rev 尚未跟上落盘值时仍要写入（B1 回归）', async () => {
    // 第一次提交：本页写入落盘，rev 推到 1
    const first = await commitWorkspace(wsOf(0, 'a'))
    expect(first).toMatchObject({ ok: true, rev: 1, skipped: false })

    // 第二次提交发生在本页内存 rev 跟上之前（"生成示例"会连续触发两次渲染）。
    // 落盘虽已领先，却是本页自己写的，必须继续写入而非误判过期、弹出误报。
    const second = await commitWorkspace(wsOf(0, 'b'))

    expect(second).toMatchObject({ ok: true, rev: 2, skipped: false })
    const stored = JSON.parse(localStorage.getItem(SCENARIOS_KEY) as string)
    expect(stored.rev).toBe(2)
    expect(stored.scenarios[0].name).toBe('b')
  })

  it('正常提交会广播新版本号给其他标签页', async () => {
    const { FakeChannel, instances } = fakeBroadcastChannel()
    vi.stubGlobal('BroadcastChannel', FakeChannel)
    const off = subscribeWorkspaceChange(() => {})

    await commitWorkspace(wsOf(0, 'a'))

    expect(instances).toHaveLength(1)
    expect(instances[0].sent).toEqual([{ rev: 1, from: expect.any(String) }])
    off()
  })

  it('subscribeWorkspaceChange：主数据键变更时回调，其他键不回调', () => {
    const win = fakeWindow()
    vi.stubGlobal('window', win)
    let calls = 0
    const off = subscribeWorkspaceChange(() => {
      calls += 1
    })

    win.emit('storage', { key: THEME_KEY })
    expect(calls).toBe(0)
    win.emit('storage', { key: SCENARIOS_KEY })
    expect(calls).toBe(1)
    win.emit('storage', { key: null })
    expect(calls).toBe(2)
    off()
  })

  it('subscribeWorkspaceChange：忽略自身回环，接收其他标签页的频道消息', async () => {
    const { FakeChannel, instances } = fakeBroadcastChannel()
    vi.stubGlobal('BroadcastChannel', FakeChannel)
    let calls = 0
    const off = subscribeWorkspaceChange(() => {
      calls += 1
    })
    await commitWorkspace(wsOf(0, 'a'))

    instances[0].receive(instances[0].sent[0])
    expect(calls).toBe(0)

    instances[0].receive({ rev: 9, from: 'another-tab' })
    expect(calls).toBe(1)
    off()
  })

  it('取消订阅：解除 storage 监听、关闭频道且不再回调', () => {
    const win = fakeWindow()
    const { FakeChannel, instances } = fakeBroadcastChannel()
    vi.stubGlobal('window', win)
    vi.stubGlobal('BroadcastChannel', FakeChannel)
    let calls = 0
    const off = subscribeWorkspaceChange(() => {
      calls += 1
    })

    expect(win.listenerCount('storage')).toBe(1)
    off()
    expect(win.listenerCount('storage')).toBe(0)
    expect(instances[0].closed).toBe(true)

    win.emit('storage', { key: SCENARIOS_KEY })
    instances[0].receive({ rev: 1, from: 'another-tab' })
    expect(calls).toBe(0)
  })
})
