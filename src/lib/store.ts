import type { Sku, Theme } from './types'
import { uid } from './engine'

const SKU_KEY = 'spec-decision:skus'
const THEME_KEY = 'spec-decision:theme'

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

/** 场景化示例数据 */
export function sampleSkus(scene: 'snack' | 'phone'): Sku[] {
  if (scene === 'snack') {
    // 3 口味 × 4 款式 = 12 个 SKU，用于演示「按定价因子聚合分簇」
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
    return out
  }
  return [
    {
      id: uid(), name: '标准版 8+128', price: 1999, quantity: 128, unit: 'GB', packs: 1,
      bonusLabel: '电池(mAh)', bonusValue: 4500, bonusWeight: 25,
    },
    {
      id: uid(), name: '增强版 12+256', price: 2599, quantity: 256, unit: 'GB', packs: 1,
      bonusLabel: '电池(mAh)', bonusValue: 5000, bonusWeight: 25,
    },
    {
      id: uid(), name: '旗舰版 16+512', price: 3499, quantity: 512, unit: 'GB', packs: 1,
      bonusLabel: '电池(mAh)', bonusValue: 5500, bonusWeight: 25,
    },
    {
      id: uid(), name: '轻奢版 8+256', price: 2899, quantity: 256, unit: 'GB', packs: 1,
      bonusLabel: '电池(mAh)', bonusValue: 4800, bonusWeight: 25,
    },
  ]
}
