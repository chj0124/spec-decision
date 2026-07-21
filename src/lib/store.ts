import type { Sku, Theme, DecisionConfig, ParamDim } from './types'
import { uid } from './engine'

const SKU_KEY = 'spec-decision:skus'
const THEME_KEY = 'spec-decision:theme'
const CONFIG_KEY = 'spec-decision:config'
const MIGRATED_KEY = 'spec-decision:migrated-v2'

/** 默认决策配置：仅价格维度 */
export const DEFAULT_CONFIG: DecisionConfig = {
  dims: [],
  priceWeight: 50,
  preference: 'value',
  budget: undefined,
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

/** 场景化示例数据：零食（多口味簇化演示）/ 手机（多维参数演示） */
export function sampleScene(scene: 'snack' | 'phone'): {
  skus: Sku[]
  config: DecisionConfig
} {
  if (scene === 'snack') {
    // 3 口味 × 4 款式 = 12 个 SKU，用于演示「按定价因子聚合分簇」
    // 零食场景没有附加参数维度，只用价格
    const flavors = ['香辣味', '原味', '烧烤味']
    const styles = [
      { q: 16, p: 8, price: 4.94 },
      { q: 16, p: 16, price: 8.9 },
      { q: 20, p: 10, price: 7.5 },
      { q: 30, p: 20, price: 16.8 },
    ]
    const out: Sku[] = []
    for (const f of flavors) {
      for (const s of styles) {
        out.push({
          id: uid(),
          name: `${f} ${s.q}g×${s.p}袋`,
          price: s.price,
          quantity: s.q,
          unit: 'g',
          packs: s.p,
        })
      }
    }
    return {
      skus: out,
      config: { ...DEFAULT_CONFIG },
    }
  }
  // 手机场景：多维参数演示
  const dimBattery: ParamDim = {
    id: 'battery',
    label: '电池容量',
    type: 'higher-better',
    weight: 25,
    unit: 'mAh',
  }
  const dimScreen: ParamDim = {
    id: 'screen',
    label: '屏幕尺寸',
    type: 'higher-better',
    weight: 15,
    unit: '英寸',
  }
  const dimWeight: ParamDim = {
    id: 'weight',
    label: '机身重量',
    type: 'lower-better',
    weight: 10,
    unit: 'g',
  }
  return {
    skus: [
      {
        id: uid(), name: '标准版 8+128', price: 1999, quantity: 128, unit: 'GB', packs: 1,
        params: { battery: 4500, screen: 6.1, weight: 175 },
      },
      {
        id: uid(), name: '增强版 12+256', price: 2599, quantity: 256, unit: 'GB', packs: 1,
        params: { battery: 5000, screen: 6.4, weight: 185 },
      },
      {
        id: uid(), name: '旗舰版 16+512', price: 3499, quantity: 512, unit: 'GB', packs: 1,
        params: { battery: 5500, screen: 6.7, weight: 198 },
      },
      {
        id: uid(), name: '轻奢版 8+256', price: 2899, quantity: 256, unit: 'GB', packs: 1,
        params: { battery: 4800, screen: 6.3, weight: 172 },
      },
    ],
    config: {
      dims: [dimBattery, dimScreen, dimWeight],
      priceWeight: 50,
      preference: 'score',
    },
  }
}
