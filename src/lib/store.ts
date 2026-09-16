import type { Sku, Theme, DecisionConfig, ParamDim } from './types'
import { uid, sanitizePriceHistory } from './engine'

const SKU_KEY = 'spec-decision:skus'
const THEME_KEY = 'spec-decision:theme'
const CONFIG_KEY = 'spec-decision:config'
const MIGRATED_KEY = 'spec-decision:migrated-v2'
const SCENARIOS_KEY = 'spec-decision:scenarios'
const CORRUPT_BACKUP_KEY = 'spec-decision:corrupt-backup'

/* ---------- 持久化健康度：写入失败不再静默吞掉 ----------
 * 页脚承诺"数据仅保存在你的浏览器本地"，那么"没存上"这件事必须让用户知道，
 * 否则用户会以为数据在，刷新后凭空消失 —— 这是最伤信任的一类失败。 */

/** 写入失败的原因：配额超限 / 存储被禁用（隐私模式、第三方存储拦截）/ 其他 */
export type PersistFailReason = 'quota' | 'blocked' | 'unknown'

export interface PersistIssue {
  key: string
  reason: PersistFailReason
  at: number
}

/** 按 localStorage key 记录未恢复的失败，避免"一个键写成功"就把别的键的失败洗掉 */
const persistIssues = new Map<string, PersistIssue>()
const persistListeners = new Set<(issue: PersistIssue | null) => void>()

/** 当前最新的未恢复失败；无失败时为 null */
let persistIssue: PersistIssue | null = null

/** 订阅持久化异常：出现失败时回调 issue，全部恢复时回调 null。返回取消订阅函数 */
export function onPersistIssue(fn: (issue: PersistIssue | null) => void) {
  persistListeners.add(fn)
  return () => {
    persistListeners.delete(fn)
  }
}

/** 当前是否存在未恢复的持久化异常（供非 React 环境读取） */
export function getPersistIssue(): PersistIssue | null {
  return persistIssue
}

/** 清除全部告警（用户手动关闭提示条）；之后若再写入失败会重新出现 */
export function clearPersistIssues() {
  if (persistIssues.size === 0) return
  persistIssues.clear()
  persistIssue = null
  persistListeners.forEach((fn) => fn(null))
}

/** 把底层异常归类，便于给出可执行的提示（清空间 / 换浏览器 / 退出隐私模式） */
function classifyStorageError(e: unknown): PersistFailReason {
  if (e instanceof DOMException) {
    const quota = ['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED', 'QUOTA_EXCEEDED_ERR']
    if (quota.includes(e.name) || e.code === 22 || e.code === 1014) return 'quota'
    if (e.name === 'SecurityError' || e.name === 'InvalidAccessError') return 'blocked'
  }
  return 'unknown'
}

function reportIssue(key: string, reason: PersistFailReason) {
  const issue: PersistIssue = { key, reason, at: Date.now() }
  persistIssues.set(key, issue)
  persistIssue = issue
  persistListeners.forEach((fn) => fn(issue))
}

function resolveIssue(key: string) {
  if (!persistIssues.delete(key)) return
  const rest = [...persistIssues.values()]
  persistIssue = rest.length > 0 ? rest.reduce((a, b) => (b.at > a.at ? b : a)) : null
  persistListeners.forEach((fn) => fn(persistIssue))
}

/** 写入单个键；失败不抛出，而是记录异常并通知订阅者 */
function write(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    resolveIssue(key)
    return true
  } catch (e) {
    reportIssue(key, classifyStorageError(e))
    return false
  }
}

/** 序列化后写入；序列化本身失败（循环引用等）同样计入异常而非崩溃 */
function writeJson(key: string, value: unknown): boolean {
  let text: string
  try {
    text = JSON.stringify(value)
  } catch {
    reportIssue(key, 'unknown')
    return false
  }
  return write(key, text)
}

/**
 * 脏数据留档：把无法解析 / 结构不可用的原文备份到独立键。
 * 这样即使用户数据损坏，也有据可查、可人工恢复，而不是被静默覆盖后凭空消失。
 * 备份写入失败只上报异常，不抛出（不能因为"存不下备份"把首屏带崩）。
 */
function backupCorrupt(raw: string) {
  write(CORRUPT_BACKUP_KEY, raw)
}

/** 一份独立清单（场景）：自己的 SKU 列表 + 决策配置，互不干扰 */
export interface Scenario {
  id: string
  name: string
  skus: Sku[]
  config: DecisionConfig
  updatedAt: number
}

export interface Workspace {
  scenarios: Scenario[]
  activeId: string
  /** 落盘版本号：每次成功写入 +1。多标签页据此判断"存储是否已被别处推进"（B1） */
  rev: number
}

/** 默认决策配置：仅价格维度 */
export const DEFAULT_CONFIG: DecisionConfig = {
  dims: [],
  priceWeight: 50,
  preference: 'value',
  budget: undefined,
}

/** 新建一个空清单 */
export function newScenario(name: string, skus: Sku[] = [], config?: DecisionConfig): Scenario {
  return {
    id: uid(),
    name: name.trim() || '未命名清单',
    skus,
    config: config ?? { ...DEFAULT_CONFIG, dims: [] },
    updatedAt: Date.now(),
  }
}

export function loadSkus(): Sku[] {
  try {
    const raw = localStorage.getItem(SKU_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export function saveSkus(skus: Sku[]) {
  writeJson(SKU_KEY, skus)
}

export function loadTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light' // 默认浅色（薄荷绿风）
  } catch {
    // 存储被禁用时连读都会抛：降级为默认主题，不能让首屏直接崩
    return 'light'
  }
}

export function saveTheme(t: Theme) {
  write(THEME_KEY, t)
}

export function loadConfig(): DecisionConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (!raw) return { ...DEFAULT_CONFIG }
    const parsed = JSON.parse(raw) as Partial<DecisionConfig>
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      dims: Array.isArray(parsed.dims) ? parsed.dims : [],
    }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveConfig(c: DecisionConfig) {
  writeJson(CONFIG_KEY, c)
}

/**
 * 一次性迁移 v1 → v2：
 *  - 旧 SKU 的 bonusLabel/bonusValue/bonusWeight → params['migrated-bonus']
 *  - 自动添加对应 ParamDim 到 config.dims
 *  - 已迁移过则跳过
 */
export function migrateV1ToV2(): { skus: Sku[]; config: DecisionConfig; changed: boolean } {
  if (localStorage.getItem(MIGRATED_KEY)) {
    return { skus: loadSkus(), config: loadConfig(), changed: false }
  }
  const skus = loadSkus()
  const config = loadConfig()

  const hasBonus = skus.some((s) => s.bonusLabel && s.bonusValue != null)
  let newSkus = skus
  let newConfig = config

  if (hasBonus) {
    const dimId = 'migrated-bonus'
    newSkus = skus.map((s) => {
      if (s.bonusLabel && s.bonusValue != null && !s.params) {
        return { ...s, params: { [dimId]: s.bonusValue } }
      }
      return s
    })
    if (!config.dims.find((d) => d.id === dimId)) {
      const sample = skus.find((s) => s.bonusLabel)
      const newDim: ParamDim = {
        id: dimId,
        label: sample?.bonusLabel || '加分参数',
        type: 'higher-better',
        weight: sample?.bonusWeight ?? 25,
      }
      newConfig = { ...config, dims: [...config.dims, newDim] }
    }
    saveSkus(newSkus)
    saveConfig(newConfig)
  }
  write(MIGRATED_KEY, '1')
  return { skus: newSkus, config: newConfig, changed: true }
}

/**
 * 由旧的单份 skus/config 组装出初始工作区（纯函数，不落盘）。
 * 供两条降级路径复用：首次使用（键不存在）、脏数据（禁止覆盖原键）。
 */
function buildMigratedWorkspace(): Workspace {
  const legacySkus = loadSkus()
  const legacyConfig = loadConfig()
  const scenario = newScenario(
    legacySkus.length > 0 ? '我的清单' : '默认清单',
    legacySkus,
    legacyConfig,
  )
  // 过一遍清洗：顺带把老数据的价格历史播种补上（见 sanitizeSkus）
  const scenarios = sanitizeScenarios([scenario])
  return { scenarios, activeId: scenarios[0].id, rev: 0 }
}

/** 从任意来源取出版本号：非数字 / 缺失一律按 0 处理（老数据没有 rev） */
function revOf(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0
}

/** 首次升级到多清单：把旧的单份 skus/config 包成「我的清单」并落盘 */
function migrateToWorkspace(): Workspace {
  const ws = buildMigratedWorkspace()
  saveWorkspace(ws)
  return ws
}

/**
 * 清洗 SKU 列表，并补全价格历史（price-history 迁移）：
 *  - 丢弃没有 id 的残项
 *  - 历史点非法则清洗（见 sanitizePriceHistory）
 *  - 老数据没有历史但有价格时，用当前价格播下第一个点 ——
 *    这样后续改价才有比较基准，能提示涨价/降价
 */
function sanitizeSkus(input: unknown): Sku[] {
  if (!Array.isArray(input)) return []
  const now = Date.now()
  return (input as Array<Partial<Sku>>)
    .filter((s): s is Sku => Boolean(s && s.id))
    .map((s) => {
      const history = sanitizePriceHistory(s.priceHistory)
      const price = Number(s.price)
      const seeded = history.length > 0 || !(price > 0) ? history : [{ t: now, price }]
      return { ...s, priceHistory: seeded }
    })
}

/**
 * 清洗外部来源（localStorage / 备份文件）的清单数组：
 * 丢弃结构不完整的项，补全缺省字段，避免脏数据把整份工作区带崩。
 */
function sanitizeScenarios(input: unknown): Scenario[] {
  if (!Array.isArray(input)) return []
  return (input as Array<Partial<Scenario>>)
    .filter((s): s is Scenario => Boolean(s && s.id && Array.isArray(s.skus) && s.config))
    .map((s) => ({
      ...s,
      name: s.name || '未命名清单',
      skus: sanitizeSkus(s.skus),
      config: { ...DEFAULT_CONFIG, ...s.config, dims: Array.isArray(s.config.dims) ? s.config.dims : [] },
      updatedAt: s.updatedAt ?? Date.now(),
    }))
}

/** 读取工作区的结果：区分「正常」「首次使用」「脏数据」，由调用方决定是否迁移 */
type WorkspaceRead =
  | { status: 'ok'; workspace: Workspace }
  | { status: 'empty' }
  | { status: 'corrupt' }

/**
 * 纯读取：只解析 localStorage，不产生任何写入 / 迁移副作用。
 * 解析失败或结构不可用时，先把原文备份到 corrupt-backup，再返回 corrupt ——
 * **绝不覆盖原键**：静默覆盖会让用户数据"凭空消失"且无从追溯（见风险卡 R2）。
 */
function readWorkspace(): WorkspaceRead {
  let raw: string | null
  try {
    raw = localStorage.getItem(SCENARIOS_KEY)
  } catch {
    // 存储被禁用（隐私模式 / 第三方存储拦截）：连读都抛，无法判断内容，按"无数据"降级
    return { status: 'empty' }
  }
  if (!raw) return { status: 'empty' }

  let parsed: Partial<Workspace>
  try {
    parsed = JSON.parse(raw) as Partial<Workspace>
  } catch {
    backupCorrupt(raw)
    return { status: 'corrupt' }
  }

  const scenarios = sanitizeScenarios(parsed.scenarios)
  if (scenarios.length === 0) {
    backupCorrupt(raw)
    return { status: 'corrupt' }
  }

  const activeId = parsed.activeId && scenarios.some((s) => s.id === parsed.activeId)
    ? parsed.activeId
    : scenarios[0].id
  return { status: 'ok', workspace: { scenarios, activeId, rev: revOf(parsed.rev) } }
}

/**
 * 读取全部清单与当前激活项：
 *  - 正常数据 → 直接返回（纯读取，零副作用）
 *  - 首次使用 → 显式迁移并落盘
 *  - 脏数据 → 已备份原文，降级为可用工作区但**不覆盖**原键
 */
export function loadWorkspace(): Workspace {
  const read = readWorkspace()
  if (read.status === 'ok') return read.workspace
  if (read.status === 'empty') return migrateToWorkspace()
  return buildMigratedWorkspace()
}

export function saveWorkspace(ws: Workspace) {
  writeJson(SCENARIOS_KEY, ws)
}

/* ---------- 多标签页一致性（B1） ----------
 * 同一浏览器开多个标签页时，各自持有一份内存工作区，localStorage 却是共享的。
 * 没有协议时后写的会整份覆盖先写的 —— 用户的改动"凭空消失"且毫无提示。这里做三件事：
 *   1) 写入经 navigator.locks 串行化，避免两个标签页读改写交错（lost update）；
 *   2) 每份工作区带 rev 版本号，写入前若发现存储里 rev 更大，说明别处已推进；
 *   3) 此时不直接覆盖，而是以"本页上次同步快照"为 base 做三方合并：
 *      场景按 id 并集、场景内的 SKU 也按 id 并集 —— 两边的新增都保住；
 *      同一项两边都改过时，以存储里的（较新的）那版为准。
 */

/** 广播通道名与写锁名（同源所有标签页共用同一把） */
const WS_CHANNEL = 'spec-decision:workspace'
const WS_LOCK = 'spec-decision:workspace-write'

export type SaveOutcome =
  /** 无冲突，直接落盘 */
  | { status: 'saved'; workspace: Workspace }
  /** 存储里 rev 更大（别处已改）：已三方合并后落盘，调用方应采纳返回的工作区 */
  | { status: 'merged'; workspace: Workspace }
  /** 写入失败（配额 / 被禁用），已通过持久化异常通道上报 */
  | { status: 'failed'; workspace: Workspace }

/** 两个值是否等价（用于判断某一侧是否真的改过） */
function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * 合并同一份清单里的 SKU 列表：按 id 并集。
 *  - 只有一侧有：若 base 里也有 → 是另一侧删掉了它（尊重删除）；base 里没有 → 是本侧新增（保留）
 *  - 两侧都有：以 base 判断谁改过；都改过时用 remote（rev 更大的一方）
 */
function mergeSkus(local: Sku[], remote: Sku[], base: Sku[]): Sku[] {
  const baseById = new Map(base.map((s) => [s.id, s]))
  const localById = new Map(local.map((s) => [s.id, s]))
  const remoteById = new Map(remote.map((s) => [s.id, s]))

  const order: string[] = []
  const seen = new Set<string>()
  for (const s of local) if (!seen.has(s.id)) { seen.add(s.id); order.push(s.id) }
  for (const s of remote) if (!seen.has(s.id)) { seen.add(s.id); order.push(s.id) }

  const out: Sku[] = []
  for (const id of order) {
    const l = localById.get(id)
    const r = remoteById.get(id)
    const b = baseById.get(id)
    if (l && r) {
      const rChanged = !b || !sameJson(r, b)
      const lChanged = !b || !sameJson(l, b)
      out.push(rChanged || !lChanged ? r : l)
    } else if (l) {
      if (b && !r) continue // base 有、remote 无：remote 删了它
      out.push(l)
    } else if (r) {
      if (b && !l) continue // base 有、local 无：local 删了它
      out.push(r)
    }
  }
  return out
}

/** 合并同一份清单：名称 / 配置按"谁改过用谁"，SKU 列表按 id 三方合并 */
function mergeScenario(local: Scenario, remote: Scenario, base?: Scenario): Scenario {
  const rChanged = !base || !sameJson({ name: remote.name, config: remote.config }, { name: base.name, config: base.config })
  const lChanged = !base || !sameJson({ name: local.name, config: local.config }, { name: base.name, config: base.config })
  const meta = rChanged || !lChanged
    ? { name: remote.name, config: remote.config }
    : { name: local.name, config: local.config }
  return {
    id: local.id,
    ...meta,
    skus: mergeSkus(local.skus, remote.skus, base?.skus ?? []),
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
  }
}

/**
 * 三方合并工作区：base 是本页"上次与存储对齐时的快照"。
 * 场景按 id 并集（两边新增都保留、尊重删除），激活项优先保留本页仍然存在的那个。
 */
export function mergeWorkspace(local: Workspace, remote: Workspace, base: Workspace): Workspace {
  const baseById = new Map(base.scenarios.map((s) => [s.id, s]))
  const localById = new Map(local.scenarios.map((s) => [s.id, s]))
  const remoteById = new Map(remote.scenarios.map((s) => [s.id, s]))

  const order: string[] = []
  const seen = new Set<string>()
  for (const s of local.scenarios) if (!seen.has(s.id)) { seen.add(s.id); order.push(s.id) }
  for (const s of remote.scenarios) if (!seen.has(s.id)) { seen.add(s.id); order.push(s.id) }

  const scenarios: Scenario[] = []
  for (const id of order) {
    const l = localById.get(id)
    const r = remoteById.get(id)
    const b = baseById.get(id)
    if (l && r) {
      scenarios.push(mergeScenario(l, r, b))
    } else if (l) {
      if (b && !r) continue // base 有、remote 无：remote 删了这份清单
      scenarios.push(l)
    } else if (r) {
      if (b && !l) continue // base 有、local 无：local 删了这份清单
      scenarios.push(r)
    }
  }

  // 兜底：两端至少各有一份，理论上到不了这里；真到了也不能返回空工作区
  if (scenarios.length === 0) scenarios.push(...local.scenarios)

  const activeId = scenarios.some((s) => s.id === local.activeId)
    ? local.activeId
    : scenarios.some((s) => s.id === remote.activeId)
      ? remote.activeId
      : scenarios[0].id

  return { scenarios, activeId, rev: Math.max(local.rev, remote.rev) }
}

/* ---------- 跨标签页信号：storage 事件 + BroadcastChannel ---------- */

/** 已向本页订阅者播报过的最大 rev：storage 与 BroadcastChannel 会重复触发，靠它去重 */
let lastExternalRev = -1

/** 广播通道（同源所有标签页共享）；环境不支持时为 null，自动退化为仅靠 storage 事件 */
let channel: BroadcastChannel | null = null
try {
  if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(WS_CHANNEL)
} catch {
  channel = null
}

/** 落盘成功后广播给其它标签页；同时把自己的 rev 记入 lastExternalRev，避免自己的写入被当成外部变更 */
function broadcastWorkspace(ws: Workspace) {
  lastExternalRev = Math.max(lastExternalRev, ws.rev)
  try {
    channel?.postMessage({ type: 'workspace', workspace: ws })
  } catch {
    /* 广播失败不影响落盘本身 */
  }
}

const externalListeners = new Set<(ws: Workspace) => void>()

/** 别处推进了存储：只有确实比本页 base 新时才通知，避免旧广播把界面搅乱 */
function emitExternal(ws: Workspace) {
  if (!ws || typeof ws.rev !== 'number' || ws.rev <= lastExternalRev) return
  lastExternalRev = ws.rev
  const base = workspaceSync.getBase()
  if (base && ws.rev <= base.rev) return
  externalListeners.forEach((fn) => fn(ws))
}

/** 订阅"另一标签页改了工作区"；返回取消订阅函数 */
export function onExternalWorkspace(fn: (ws: Workspace) => void) {
  externalListeners.add(fn)
  return () => {
    externalListeners.delete(fn)
  }
}

if (typeof window !== 'undefined') {
  // storage 事件只在"别的标签页"写入时触发，正好是我们要的"外部变更"信号
  window.addEventListener('storage', (e) => {
    if (e.key !== SCENARIOS_KEY) return
    const read = readWorkspace()
    if (read.status === 'ok') emitExternal(read.workspace)
  })
}

channel?.addEventListener('message', (e: MessageEvent) => {
  const data = e.data as { type?: string; workspace?: Workspace } | null
  if (data?.type === 'workspace' && data.workspace) emitExternal(data.workspace)
})

/* ---------- 串行化写入器 ---------- */

type LockLike = { request<T>(name: string, cb: () => Promise<T> | T): Promise<T> }

/** 用 Web Locks 串行化写入；环境不支持（测试 / 老浏览器）时退化为直接执行 */
function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined'
    ? (navigator as Navigator & { locks?: LockLike }).locks
    : undefined
  if (locks && typeof locks.request === 'function') return locks.request<T>(WS_LOCK, () => fn())
  return fn()
}

/** 一个标签页的工作区同步器：各自持有自己的 base 快照（三方合并的公共祖先） */
export interface WorkspaceSync {
  /** 登记本页与存储对齐的初始快照；启动时调用一次 */
  prime(ws: Workspace): void
  /** 当前 base 快照 */
  getBase(): Workspace | null
  /** 串行化、带 rev 校验的保存：检测到别处已推进就合并而非覆盖 */
  save(next: Workspace): Promise<SaveOutcome>
}

export function createWorkspaceSync(): WorkspaceSync {
  let base: Workspace | null = null

  async function commit(next: Workspace): Promise<SaveOutcome> {
    const read = readWorkspace()
    const stored = read.status === 'ok' ? read.workspace : null

    // 内容与存储一致（新开一个标签页、或本页状态没有实质变化）：不落盘、不推进 rev、不广播。
    // 否则"打开标签页"本身就会凭空制造一次版本推进，让别的标签页弹出"另一标签页已修改"的误报。
    if (
      stored &&
      sameJson(
        { scenarios: next.scenarios, activeId: next.activeId },
        { scenarios: stored.scenarios, activeId: stored.activeId },
      )
    ) {
      base = stored
      return { status: 'saved', workspace: stored }
    }

    let out: Workspace
    let merged = false
    if (stored && base && stored.rev > base.rev) {
      // 别处已推进：合并而非覆盖，避免把别人的改动抹掉
      out = mergeWorkspace(next, stored, base)
      merged = true
    } else {
      out = { scenarios: next.scenarios, activeId: next.activeId, rev: 0 }
    }

    out.rev = Math.max(stored?.rev ?? 0, base?.rev ?? 0) + 1
    if (!writeJson(SCENARIOS_KEY, out)) return { status: 'failed', workspace: out }
    base = out
    broadcastWorkspace(out)
    return { status: merged ? 'merged' : 'saved', workspace: out }
  }

  return {
    prime(ws) {
      base = ws
    },
    getBase: () => base,
    save: (next) => withWriteLock(() => commit(next)),
  }
}

/** 全应用共享的同步器（浏览器运行时） */
export const workspaceSync = createWorkspaceSync()

/* ---------- 工作区备份 / 还原（跨设备搬运 / 防清缓存丢失） ---------- */

const BACKUP_APP = 'spec-decision'
const BACKUP_VERSION = 1

export interface WorkspaceBackup {
  app: string
  v: number
  exportedAt: number
  workspace: Workspace
}

/** 序列化为备份文本（含校验头，导入时可识别是否为本应用产出） */
export function exportWorkspace(ws: Workspace): string {
  const backup: WorkspaceBackup = {
    app: BACKUP_APP,
    v: BACKUP_VERSION,
    exportedAt: Date.now(),
    workspace: { scenarios: ws.scenarios, activeId: ws.activeId, rev: ws.rev },
  }
  return JSON.stringify(backup, null, 2)
}

/** 解析备份文本；非本应用 / 结构非法 / 清单全空时返回 null，由调用方提示用户 */
export function importWorkspace(text: string): Workspace | null {
  try {
    const parsed = JSON.parse(text) as Partial<WorkspaceBackup>
    if (!parsed || parsed.app !== BACKUP_APP) return null
    const raw = parsed.workspace as Partial<Workspace> | undefined
    const scenarios = sanitizeScenarios(raw?.scenarios)
    if (scenarios.length === 0) return null
    const activeId = raw?.activeId && scenarios.some((s) => s.id === raw.activeId)
      ? raw.activeId
      : scenarios[0].id
    return { scenarios, activeId, rev: revOf(raw?.rev) }
  } catch {
    return null
  }
}

/** 决策引擎与示例生成已迁移至 aiSample.ts（AI 生成 / 内置真实模板兜底）。 */
