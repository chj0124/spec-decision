import type { Sku, Theme, DecisionConfig, ParamDim } from './types'
import { uid } from './engine'

const SKU_KEY = 'spec-decision:skus'
const THEME_KEY = 'spec-decision:theme'
const CONFIG_KEY = 'spec-decision:config'
const MIGRATED_KEY = 'spec-decision:migrated-v2'
const SCENARIOS_KEY = 'spec-decision:scenarios'
const ACTIVE_KEY = 'spec-decision:active-scenario'

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
  try {
    localStorage.setItem(SKU_KEY, JSON.stringify(skus))
  } catch {
    /* 忽略写入失败 */
  }
}

export function loadTheme(): Theme {
  const t = localStorage.getItem(THEME_KEY)
  return t === 'dark' ? 'dark' : 'light' // 默认浅色（薄荷绿风）
}

export function saveTheme(t: Theme) {
  localStorage.setItem(THEME_KEY, t)
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
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(c))
  } catch {
    /* 忽略写入失败 */
  }
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
  localStorage.setItem(MIGRATED_KEY, '1')
  return { skus: newSkus, config: newConfig, changed: true }
}

/** 首次升级到多清单：把旧的单份 skus/config 包成「我的清单」 */
function migrateToWorkspace(): Workspace {
  const legacySkus = loadSkus()
  const legacyConfig = loadConfig()
  const scenario = newScenario(
    legacySkus.length > 0 ? '我的清单' : '默认清单',
    legacySkus,
    legacyConfig,
  )
  const ws: Workspace = { scenarios: [scenario], activeId: scenario.id }
  saveWorkspace(ws)
  return ws
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
      config: { ...DEFAULT_CONFIG, ...s.config, dims: Array.isArray(s.config.dims) ? s.config.dims : [] },
      updatedAt: s.updatedAt ?? Date.now(),
    }))
}

/** 读取全部清单与当前激活项；无数据或数据损坏时回退到单份旧数据 */
export function loadWorkspace(): Workspace {
  try {
    const raw = localStorage.getItem(SCENARIOS_KEY)
    if (!raw) return migrateToWorkspace()
    const parsed = JSON.parse(raw) as Partial<Workspace>
    const scenarios = sanitizeScenarios(parsed.scenarios)
    if (scenarios.length === 0) return migrateToWorkspace()

    const activeId = parsed.activeId && scenarios.some((s) => s.id === parsed.activeId)
      ? parsed.activeId
      : scenarios[0].id
    return { scenarios, activeId }
  } catch {
    return migrateToWorkspace()
  }
}

export function saveWorkspace(ws: Workspace) {
  try {
    localStorage.setItem(SCENARIOS_KEY, JSON.stringify(ws))
    localStorage.setItem(ACTIVE_KEY, ws.activeId)
  } catch {
    /* 忽略写入失败（如隐私模式配额超限） */
  }
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
