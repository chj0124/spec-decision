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

/**
 * 品类/包装词：被拼进「口味」首词时属于污染（如"橙味汽水"、"柠檬味饮料"）。
 * 这些词描述的是商品品类而非口味本身，剥掉后才能让同口味的规格归到同一组。
 * 按长词优先匹配后缀，且剥离后必须非空（避免"汽水"被清成空串）。
 */
const FLAVOR_CATEGORY_SUFFIXES = [
  '气泡水', '苏打水', '矿泉水', '纯净水', '饮用水', '果味水',
  '汽水', '饮料', '可乐', '果汁', '果茶', '奶茶', '茶饮',
  '酸奶', '牛奶', '乳饮', '矿泉',
]

/**
 * 从口味首词剥离尾部的品类词。
 * 例："橙味汽水" → "橙味"；"芬达" / "香辣味" 原样返回（无法从词形判断品牌或真口味）。
 */
export function stripFlavorCategory(flavor: string): string {
  let f = flavor.trim()
  for (const w of FLAVOR_CATEGORY_SUFFIXES) {
    if (f.length > w.length && f.endsWith(w)) {
      f = f.slice(0, -w.length)
      break
    }
  }
  return f
}

/**
 * 含量型计量单位（质量 / 体积）。
 * 只有这类单位才用「含量×件数」的规格写法，也才适合把 AI 名称重建为规范写法；
 * 手机（个/GB）、螺丝（mm）、纸巾（抽）等不能套用，否则 "M4×10mm" 会被误改成 "4×10袋"。
 */
const CONTENT_UNITS = new Set([
  'g', 'kg', 'mg', 'ml', 'l', 'dl', 'cl', 'cc',
  '克', '千克', '公斤', '毫克', '毫升', '升', '斤', '两',
])

/** 是否为含量型单位（质量/体积），大小写与首尾空白不敏感 */
export function isContentUnit(unit: string): boolean {
  return CONTENT_UNITS.has(unit.trim().toLowerCase())
}

/**
 * 批量 / 外箱量词：比价看的是最小可比单位（瓶/袋），这类词只描述包装层级，
 * 不进展示量词（"888ml*12整箱" 应展示为 "888ml×12瓶"）。
 */
const BULK_PACK_UNITS = ['箱', '件', '提', '板', '托', '组']

/** 归一化件数量词：批量/外箱量词一律丢弃（交给 buildSpec 按单位回退），其余原样返回 */
export function normalizePackUnit(packUnit?: string): string | undefined {
  if (!packUnit) return undefined
  return BULK_PACK_UNITS.includes(packUnit.trim()) ? undefined : packUnit
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

/**
 * 由「口味 + 结构化字段」拼出规范名称：`口味 含量单位×件数量词`。
 * 识别结果一律走这里重建 name，保证规格列永远是 parseSpec 可往返的标准写法，
 * 不再出现 "*" 分隔符、件数没乘好、品类词混进规格列等对不齐的问题。
 */
export function buildName(flavor: string, quantity: number, unit: string, packs: number, packUnit?: string): string {
  const spec = buildSpec(quantity, unit, packs, packUnit)
  const f = flavor.trim()
  return f ? `${f} ${spec}`.trim() : spec
}
