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
  return { scenarios, activeId: scenarios[0].id }
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
  return { status: 'ok', workspace: { scenarios, activeId } }
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
    workspace: { scenarios: ws.scenarios, activeId: ws.activeId },
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
    return { scenarios, activeId }
  } catch {
    return null
  }
}

/** 决策引擎与示例生成已迁移至 aiSample.ts（AI 生成 / 内置真实模板兜底）。 */
