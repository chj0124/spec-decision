import type { Sku } from '../types'

/* ============ 录入表格：口味拆分 + 分组折叠 ============ */

export type GroupBy = 'flavor' | 'quantity' | 'packs' | `dim:${string}`

/**
 * 从规格名称拆出「口味」与「规格描述」。
 * 例："香辣味 16g×8袋" → flavor="香辣味", spec="16g×8袋"
 * 取首个空白/空格前的词作口味；无空格则整段视为规格、口味留空。
 * 注意：空白类需同时覆盖半角空格与全角空格（\u3000），中文录入里两者都会出现。
 */
export function parseFlavor(name: string): { flavor: string; spec: string } {
  const trimmed = name.trim()
  if (!trimmed) return { flavor: '', spec: '' }
  const m = trimmed.match(/^([^\s\u3000]+)[\s\u3000]+(.+)$/)
  if (m) return { flavor: m[1], spec: m[2].trim() }
  return { flavor: '', spec: trimmed }
}

/** 按指定维度对 SKU 分组（用于录入表格的折叠展示） */
export function groupSkus(skus: Sku[], by: GroupBy): Array<{ key: string; items: Sku[] }> {
  const map = new Map<string, Sku[]>()
  for (const s of skus) {
    let key = ''
    if (by === 'flavor') key = parseFlavor(s.name).flavor || '（无）'
    else if (by === 'quantity') key = `${s.quantity}${s.unit}`
    else if (by === 'packs') key = `${s.packs}件`
    else if (by.startsWith('dim:')) {
      // 按参数维度分组：key = dim:dimId → 取该 SKU 在该维度的值
      const dimId = by.slice(4)
      key = String(s.params?.[dimId] ?? '（未设）')
    }
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(s)
  }
  return [...map.entries()].map(([key, items]) => ({ key, items }))
}

/* ============ 规格描述 ↔ 结构化字段 双向同步 ============ */

export interface SpecParts {
  quantity: number
  unit: string
  packs: number
  /** 件数量词（如 袋/瓶/罐/盒），从描述尾部提取；缺省表示未写量词 */
  packUnit?: string
}

/** 常见件数量词（用于规格描述尾部提取，如 "16g×8袋" 的 "袋"） */
const PACK_UNIT_WORDS = '袋|包|盒|罐|瓶|箱|桶|听|支|条|片|张|本|卷|双|副|把|只|个|件|枚|粒|块'

/**
 * 从规格描述解析结构化字段。
 * 支持："38g×20袋" "16g*8袋" "16gx8" "500ml×6瓶" "8+128" 等。
 * 例："38g×20袋" → { quantity:38, unit:'g', packs:20, packUnit:'袋' }
 */
export function parseSpec(spec: string): Partial<SpecParts> {
  const t = spec.trim()
  if (!t) return {}
  // 主模式：数字+单位 ×/x/*/× 数字 [量词]
  const m = t.match(
    new RegExp(`(\\d+(?:\\.\\d+)?)\\s*([a-zA-Z\\u4e00-\\u9fa5]*)\\s*[×xX*]\\s*(\\d+(?:\\.\\d+)?)\\s*(${PACK_UNIT_WORDS})?`),
  )
  if (m) {
    return {
      quantity: parseFloat(m[1]),
      unit: m[2] || '',
      packs: Math.max(1, Math.round(parseFloat(m[3]))),
      ...(m[4] ? { packUnit: m[4] } : {}),
    }
  }
  // 退化：仅 "数字+单位"（无件数）
  const m2 = t.match(/(\d+(?:\.\d+)?)\s*([a-zA-Z\u4e00-\u9fa5]+)/)
  if (m2) return { quantity: parseFloat(m2[1]), unit: m2[2] }
  return {}
}

/**
 * 由结构化字段拼出规格描述。
 * 例：{ quantity:38, unit:'g', packs:20, packUnit:'袋' } → "38g×20袋"
 * packUnit 缺省（手填/旧数据）时回退高频场景的"袋"。
 */
export function buildSpec(quantity: number, unit: string, packs: number, packUnit?: string): string {
  if (!(quantity > 0)) return ''
  const q = String(quantity)
  const p = packs > 0 ? packs : 1
  return `${q}${unit}×${p}${packUnit || '袋'}`
}
