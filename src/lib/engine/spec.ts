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
 * 一组「×数量[量词]」的正则片段（可重复出现），如 "*12瓶*2箱"。
 * 电商规格里复合写法极常见（整箱 = 12瓶 × 2箱），必须连乘才能得到真实总件数：
 * 否则 "300ml*12瓶*2箱" 会被当成 12 件，7200ml 被算成 3600ml，比价结论直接反了。
 */
const PACK_GROUP_SRC = `[×xX*]\\s*(\\d+(?:\\.\\d+)?)\\s*(${PACK_UNIT_WORDS})?`

/**
 * 规格片段：数字 + 单位 + 至少一组「×数量[量词]」。
 * 导出给极速录入复用——它需要从整行商品标题里定位规格出现的位置。
 */
export const SPEC_PATTERN = new RegExp(
  `(\\d+(?:\\.\\d+)?)\\s*([a-zA-Z\\u4e00-\\u9fa5]*)\\s*(?:${PACK_GROUP_SRC})+`,
)

/**
 * 从规格描述解析结构化字段。
 * 支持："38g×20袋" "16g*8袋" "16gx8" "500ml×6瓶" "300ml*12瓶*2箱" 等。
 * 复合件数连乘、量词取最内层（瓶优先于箱，因为比价看的是每瓶价）：
 * 例："300ml*12瓶*2箱" → { quantity:300, unit:'ml', packs:24, packUnit:'瓶' }
 */
export function parseSpec(spec: string): Partial<SpecParts> {
  const t = spec.trim()
  if (!t) return {}
  const m = t.match(SPEC_PATTERN)
  if (m) {
    // 按第一个分隔符切开头尾，避免 "16 g×8袋" 这类带空格的写法算错偏移
    const sepIdx = m[0].search(/[×xX*]/)
    const head = m[0].slice(0, sepIdx).match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z\u4e00-\u9fa5]*)/)
    const groups = [...m[0].slice(sepIdx).matchAll(new RegExp(PACK_GROUP_SRC, 'g'))]
    const packs = groups.reduce((acc, g) => acc * Math.max(1, Math.round(parseFloat(g[1]))), 1)
    const packUnit = groups.map((g) => g[2]).find(Boolean)
    return {
      quantity: head ? parseFloat(head[1]) : 0,
      unit: head?.[2] || '',
      packs,
      ...(packUnit ? { packUnit } : {}),
    }
  }
  // 退化：仅 "数字+单位"（无件数）
  const m2 = t.match(/(\d+(?:\.\d+)?)\s*([a-zA-Z\u4e00-\u9fa5]+)/)
  if (m2) return { quantity: parseFloat(m2[1]), unit: m2[2] }
  return {}
}

/**
 * 规格描述缺省量词：按计量单位推断，避免饮料被拼成 "500ml×24袋"。
 * 液量单位回退「瓶」，其余沿用高频场景的「袋」。
 */
const DEFAULT_PACK_UNIT: Record<string, string> = {
  ml: '瓶', mL: '瓶', ML: '瓶', l: '瓶', L: '瓶', 毫升: '瓶', 升: '瓶',
}

/**
 * 由结构化字段拼出规格描述。
 * 例：{ quantity:38, unit:'g', packs:20, packUnit:'袋' } → "38g×20袋"
 * packUnit 缺省（手填/旧数据）时按单位推断，再不行回退"袋"。
 */
export function buildSpec(quantity: number, unit: string, packs: number, packUnit?: string): string {
  if (!(quantity > 0)) return ''
  const q = String(quantity)
  const p = packs > 0 ? packs : 1
  return `${q}${unit}×${p}${packUnit || DEFAULT_PACK_UNIT[unit] || '袋'}`
}
