import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  loadWorkspace, exportWorkspace, importWorkspace, saveWorkspace, saveSkus, saveTheme,
  loadTheme, onPersistIssue, getPersistIssue, clearPersistIssues,
  commitWorkspace, readStoredRev, subscribeWorkspaceChange,
  DRAFT_KEY, readDraft, writeDraft, clearDraft, loadRecoverableDraft, createDraftScheduler,
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
function seed(skus: Sku[], updatedAt = 1) {
  const ws: Workspace = {
    scenarios: [
      {
        id: 's1',
        name: '测试清单',
        skus,
        config: { dims: [], priceWeight: 50, preference: 'value' },
        updatedAt,
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

  // 回归守卫（D15）：播种时间必须取清单的 updatedAt，而非 Date.now()。
  // 用 now 会把"久未更新"的老数据伪装成"刚刚录入"，让新鲜度/过期提示全部失效。
  it('老数据播种时间取清单 updatedAt，而不是当前时间', () => {
    seed([sku()], 1)
    const seeded = loadWorkspace().scenarios[0].skus[0].priceHistory?.[0]
    expect(seeded?.t).toBe(1)
    expect(seeded?.price).toBe(9.9)
  })

  it('清单缺少 updatedAt 时播种时间回退当前时间（不能变成 0/NaN）', () => {
    const before = Date.now()
    localStorage.setItem(
      SCENARIOS_KEY,
      JSON.stringify({
        scenarios: [
          {
            id: 's1',
            name: '测试清单',
            skus: [sku()],
            config: { dims: [], priceWeight: 50, preference: 'value' },
          },
        ],
        activeId: 's1',
        rev: 0,
      }),
    )
    const t = loadWorkspace().scenarios[0].skus[0].priceHistory?.[0].t ?? 0
    expect(t).toBeGreaterThanOrEqual(before)
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

/* ---------- 自动草稿（F6）：崩溃 / 关闭后的恢复安全网 ----------
 * 草稿是本标签页私有的一份副本（不进 rev 竞争、不写主数据键）：
 *  - 提交成功时它等于落盘内容，重开时判定为"已同步"，不打扰用户；
 *  - 提交被拒（过期）/ 关页前没来得及落盘时，它是改动唯一的落点，重开可恢复。
 */

describe('自动草稿（F6）', () => {
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

  afterEach(() => {
    vi.useRealTimers()
  })

  it('readDraft：无草稿 / 脏草稿都返回 null，不抛不崩', () => {
    expect(readDraft()).toBeNull()

    localStorage.setItem(DRAFT_KEY, '{ 这不是合法 JSON')
    expect(readDraft()).toBeNull()

    // 结构不可用（没有可用清单）同样按"无草稿"降级
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ workspace: { scenarios: [] }, baseRev: 1 }))
    expect(readDraft()).toBeNull()
  })

  it('写读往返：草稿带着工作区、基于版本号与写入时间', () => {
    expect(writeDraft(wsOf(3, '进行中'), 3)).toBe(true)

    const draft = readDraft()
    expect(draft?.workspace.scenarios[0].name).toBe('进行中')
    expect(draft?.workspace.activeId).toBe('进行中')
    expect(draft?.baseRev).toBe(3)
    expect(draft?.at).toBeGreaterThan(0)
  })

  it('写草稿不参与版本号竞争：不写主数据键、不推高 rev', async () => {
    await commitWorkspace(wsOf(0, '已落盘'))

    writeDraft(wsOf(0, '草稿内容'), 1)

    // 草稿必须落在独立键上，且主数据的名字与版本号纹丝不动
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull()
    expect(readStoredRev()).toBe(1)
    expect(JSON.parse(localStorage.getItem(SCENARIOS_KEY) as string).scenarios[0].name).toBe('已落盘')
  })

  it('草稿写入失败上报持久化异常，且不影响已落盘数据', () => {
    vi.stubGlobal('localStorage', flakyStorage((k) => (k === DRAFT_KEY ? quotaErr() : null)))
    seed([sku({ name: '已提交' })])

    expect(writeDraft(wsOf(0, '草稿'), 0)).toBe(false)
    expect(getPersistIssue()?.key).toBe(DRAFT_KEY)
    expect(loadWorkspace().scenarios[0].skus[0].name).toBe('已提交')
  })

  it('clearDraft 移除草稿键，之后读不到', () => {
    writeDraft(wsOf(0, 'a'), 0)
    expect(readDraft()).not.toBeNull()

    clearDraft()

    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
    expect(readDraft()).toBeNull()
  })

  it('可恢复判定：草稿与已落盘内容不同才算数', () => {
    localStorage.setItem(SCENARIOS_KEY, JSON.stringify(wsOf(1, '已落盘')))
    writeDraft(wsOf(1, '还没落盘'), 1)

    const draft = loadRecoverableDraft()

    expect(draft?.workspace.scenarios[0].name).toBe('还没落盘')
    expect(draft?.baseRev).toBe(1)
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull()
  })

  it('草稿与落盘内容相同：不算可恢复，并顺手清掉以免每次重开都弹提示', () => {
    localStorage.setItem(SCENARIOS_KEY, JSON.stringify(wsOf(1, 'a')))
    writeDraft(wsOf(1, 'a'), 1)

    expect(loadRecoverableDraft()).toBeNull()
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
  })

  // 回归守卫（F6）：「AI 生成示例」会先后两次 patch（skus 后 config），各推一次 updatedAt，
  // 价格历史又按 updatedAt 播种 —— 同一份内容因此出现两个时间戳不同的快照。
  // 若把它们当"内容不同"，重开时每次都会无端弹恢复条，还会挡住本页后续的草稿写入。
  it('回归守卫：仅触碰时间不同（内容一致）不算可恢复，静默清掉', () => {
    const withSku = (updatedAt: number): Scenario => ({
      ...sc('默认清单'),
      skus: [sku({ id: 'k1', price: 292.17 })],
      updatedAt,
    })
    localStorage.setItem(
      SCENARIOS_KEY,
      JSON.stringify({ scenarios: [withSku(2000)], activeId: '默认清单', rev: 2 }),
    )
    writeDraft({ scenarios: [withSku(1000)], activeId: '默认清单', rev: 0 }, 0)

    expect(loadRecoverableDraft()).toBeNull()
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
  })

  // 反向守卫：只剥离"触碰时间"，真实内容差异（这里改了价格）仍必须被判为可恢复
  it('回归守卫：内容确有差异（改了价格）仍判为可恢复', () => {
    const withPrice = (price: number, updatedAt: number): Scenario => ({
      ...sc('默认清单'),
      skus: [sku({ id: 'k1', price })],
      updatedAt,
    })
    localStorage.setItem(
      SCENARIOS_KEY,
      JSON.stringify({ scenarios: [withPrice(100, 2000)], activeId: '默认清单', rev: 2 }),
    )
    writeDraft({ scenarios: [withPrice(110, 3000)], activeId: '默认清单', rev: 2 }, 2)

    expect(loadRecoverableDraft()?.workspace.scenarios[0].skus[0].price).toBe(110)
  })

  it('存储被禁用时读草稿降级为 null（隐私模式不崩首屏）', () => {
    vi.stubGlobal('localStorage', deadStorage())

    expect(readDraft()).toBeNull()
    expect(loadRecoverableDraft()).toBeNull()
    expect(() => clearDraft()).not.toThrow()
  })

  // 回归守卫（D3）：与 B1 并发用例共用同一套叙事——提交被判过期 = 本页改动没进共享数据，
  // 若此时没有草稿兜底，用户关掉页面就永久丢了这批改动。
  it('双标签页：本页提交被判过期后，改动仍留在草稿里可恢复（不丢数据）', async () => {
    localStorage.setItem(SCENARIOS_KEY, JSON.stringify(wsOf(5, '远端')))
    const local = wsOf(2, '本地未提交')

    const res = await commitWorkspace(local)
    expect(res).toMatchObject({ ok: false, reason: 'stale' })

    writeDraft(local, local.rev)

    expect(loadRecoverableDraft()?.workspace.scenarios[0].name).toBe('本地未提交')
    // 草稿不污染共享数据：对方那一版原样还在
    expect(JSON.parse(localStorage.getItem(SCENARIOS_KEY) as string).scenarios[0].name).toBe('远端')
  })

  it('节流器：首次改动立即写入，窗口内合并，窗口结束时补写最后一次', () => {
    vi.useFakeTimers()
    const scheduler = createDraftScheduler(1000)

    // 前沿：第一次改动不等窗口，马上落盘（崩溃在窗口内也不至于全丢）
    scheduler.schedule(wsOf(0, '第一次'), 0)
    expect(readDraft()?.workspace.scenarios[0].name).toBe('第一次')

    // 窗口内连续改动只挂一个待写项，不逐次写入
    vi.advanceTimersByTime(300)
    scheduler.schedule(wsOf(0, '第二次'), 0)
    scheduler.schedule(wsOf(0, '第三次'), 0)
    expect(readDraft()?.workspace.scenarios[0].name).toBe('第一次')

    // 后沿：窗口结束补写最后一次，最后一次改动不会丢
    vi.advanceTimersByTime(700)
    expect(readDraft()?.workspace.scenarios[0].name).toBe('第三次')
  })

  it('节流器：窗口过后再改一次，重新立即写入', () => {
    vi.useFakeTimers()
    const scheduler = createDraftScheduler(1000)

    scheduler.schedule(wsOf(0, '首批'), 0)
    vi.advanceTimersByTime(1500)

    scheduler.schedule(wsOf(0, '第二批'), 0)
    expect(readDraft()?.workspace.scenarios[0].name).toBe('第二批')
  })

  it('节流器：flush 立刻补写待写内容（pagehide / 隐藏时用）', () => {
    vi.useFakeTimers()
    const scheduler = createDraftScheduler(1000)

    scheduler.schedule(wsOf(0, '已写'), 0)
    vi.advanceTimersByTime(200)
    scheduler.schedule(wsOf(0, '关页前的最后一次'), 0)

    scheduler.flush()

    expect(readDraft()?.workspace.scenarios[0].name).toBe('关页前的最后一次')
  })

  it('节流器：flush 无待写内容时是空操作，不凭空造草稿', () => {
    vi.useFakeTimers()
    const scheduler = createDraftScheduler(1000)
    scheduler.schedule(wsOf(0, '已写'), 0)

    scheduler.flush()

    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull()
    expect(readDraft()?.workspace.scenarios[0].name).toBe('已写')
  })

  it('节流器：cancel 丢弃待写内容，之后定时器也不再写入', () => {
    vi.useFakeTimers()
    const scheduler = createDraftScheduler(1000)

    scheduler.schedule(wsOf(0, '已写'), 0)
    vi.advanceTimersByTime(200)
    scheduler.schedule(wsOf(0, '不该写'), 0)

    scheduler.cancel()
    vi.advanceTimersByTime(5000)

    expect(readDraft()?.workspace.scenarios[0].name).toBe('已写')
  })
})
