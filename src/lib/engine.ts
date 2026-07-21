import type { ComputedSku, DecisionResult, MarginInsight, Sku, SkuCluster } from './types'

const round = (n: number, d = 4) => {
  const p = Math.pow(10, d)
  return Math.round(n * p) / p
}

export const uid = () => Math.random().toString(36).slice(2, 9)

/** 单位归一化：把大单位换算到基准小单位，避免 g/kg、ml/L 混算导致单价差千倍 */
const UNIT_TO_BASE: Record<string, { factor: number; base: string }> = {
  // 重量 → g
  kg: { factor: 1000, base: 'g' }, 千克: { factor: 1000, base: 'g' }, 公斤: { factor: 1000, base: 'g' },
  g: { factor: 1, base: 'g' }, 克: { factor: 1, base: 'g' },
  mg: { factor: 0.001, base: 'g' }, 毫克: { factor: 0.001, base: 'g' },
  t: { factor: 1000000, base: 'g' }, 吨: { factor: 1000000, base: 'g' },
  // 市制重量 → g
  斤: { factor: 500, base: 'g' }, 两: { factor: 50, base: 'g' }, 钱: { factor: 5, base: 'g' },
  // 英制重量 → g
  lb: { factor: 453.592, base: 'g' }, 磅: { factor: 453.592, base: 'g' },
  oz: { factor: 28.3495, base: 'g' }, 盎司: { factor: 28.3495, base: 'g' },
  // 体积 → ml
  l: { factor: 1000, base: 'ml' }, L: { factor: 1000, base: 'ml' }, 升: { factor: 1000, base: 'ml' },
  ml: { factor: 1, base: 'ml' }, 毫升: { factor: 1, base: 'ml' },
  gal: { factor: 3785.41, base: 'ml' }, 加仑: { factor: 3785.41, base: 'ml' },
  // 长度 → cm
  m: { factor: 100, base: 'cm' }, 米: { factor: 100, base: 'cm' },
  cm: { factor: 1, base: 'cm' }, 厘米: { factor: 1, base: 'cm' },
  mm: { factor: 0.1, base: 'cm' }, 毫米: { factor: 0.1, base: 'cm' },
  寸: { factor: 3.333, base: 'cm' }, 尺: { factor: 33.33, base: 'cm' },
  英寸: { factor: 2.54, base: 'cm' }, in: { factor: 2.54, base: 'cm' },
}

/** 把 (quantity, unit) 归一化到基准单位，返回 { value, base }；无法识别的单位原样返回 */
export function normalizeUnit(quantity: number, unit: string): { value: number; base: string } {
  const u = (unit || '').trim()
  const rule = UNIT_TO_BASE[u] ?? UNIT_TO_BASE[u.toLowerCase()]
  if (rule) return { value: quantity * rule.factor, base: rule.base }
  return { value: quantity, base: u }
}

/** 该单位是否在本地换算表内（决定是否需要 AI 兜底） */
export function isKnownUnit(unit: string): boolean {
  const u = (unit || '').trim()
  return Boolean(UNIT_TO_BASE[u] ?? UNIT_TO_BASE[u.toLowerCase()])
}

/**
 * 用 AI 把生僻单位归一化到基准单位（g/ml/cm/个）。
 * 仅在本地表查不到时调用；失败返回 null，调用方回退原样处理。
 */
export async function aiNormalizeUnit(
  quantity: number,
  unit: string,
): Promise<{ value: number; base: string } | null> {
  try {
    const { chat } = await import('./ai')
    const text = await chat(
      `把 ${quantity} "${unit}" 换算成对应的基准单位数值。` +
        `重量用 g、体积用 ml、长度用 cm、计件用"个"。` +
        `只返回 JSON，格式 {"value":数字,"base":"g|ml|cm|个"}，不要任何其他文字。` +
        `如果该单位不属于重量/体积/长度/计件，或无法换算，返回 {"value":null}。`,
      '你是单位换算器，只输出 JSON。',
    )
    const m = text.replace(/```json|```/g, '').match(/\{[\s\S]*\}/)
    if (!m) return null
    const data = JSON.parse(m[0])
    if (typeof data.value === 'number' && data.base) return { value: data.value, base: data.base }
    return null
  } catch {
    return null
  }
}

/** 检测一批 SKU 是否存在"基准单位不一致、无法直接比价"的情况，返回警告文案或 null */
export function unitMixWarning(skus: Sku[]): string | null {
  const bases = new Set<string>()
  for (const s of skus) {
    if (!(s.quantity > 0)) continue
    bases.add(normalizeUnit(s.quantity, s.unit).base || s.unit)
  }
  // 同一物理量纲的基准才可比；g/ml/cm/个 属不同量纲，出现多个且非同一类 → 警告
  const arr = [...bases]
  if (arr.length > 1) {
    return `检测到多种计量单位（${arr.join('、')}），它们属于不同维度，无法直接比价。请统一为同一单位后再看结果。`
  }
  return null
}

/** 计算单个 SKU 的派生值（单位已归一化） */
export function computeSku(s: Sku): ComputedSku {
  // 先把单件含量换算到基准单位，再乘件数得总量
  const norm = normalizeUnit(s.quantity, s.unit)
  const totalQuantity = round(norm.value * Math.max(1, s.packs), 4)
  // 单价 = 总价 / 基准单位总量（单位统一后跨规格可比）
  const unitPrice = totalQuantity > 0 ? round(s.price / totalQuantity, 6) : 0
  const bonusPerYuan =
    s.bonusValue && s.price > 0 ? round(s.bonusValue / s.price, 4) : undefined
  return {
    ...s,
    // unit 统一显示为基准单位，保证下游（报告/分簇/图表）口径一致
    unit: norm.base || s.unit,
    totalQuantity,
    unitPrice,
    bonusPerYuan,
    score: 0,
    rank: 0,
    isBest: false,
  }
}

/**
 * 综合评分：
 *  - 价格维度（单价越低越好）占主导
 *  - 若设置了加分参数（如内存/电池），按权重并入综合分
 * 返回 0-100 分，越高越划算
 */
export function scoreItems(items: ComputedSku[]): ComputedSku[] {
  if (items.length === 0) return items
  const prices = items.map((i) => i.unitPrice).filter((p) => p > 0)
  const minP = Math.min(...prices)
  const maxP = Math.max(...prices)
  const priceRange = maxP - minP || 1

  const bonusVals = items.map((i) => i.bonusValue ?? 0)
  const maxB = Math.max(...bonusVals, 0)
  const minB = Math.min(...bonusVals, 0)
  const bonusRange = maxB - minB || 1

  const hasBonus = items.some((i) => (i.bonusWeight ?? 0) > 0 && i.bonusValue)

  return items.map((i) => {
    // 价格得分 0-100（单价越低分越高）
    const priceScore = i.unitPrice > 0 ? ((maxP - i.unitPrice) / priceRange) * 100 : 0
    let score = priceScore
    if (hasBonus) {
      const w = Math.min(100, Math.max(0, i.bonusWeight ?? 0)) / 100
      const bonusScore = i.bonusValue ? ((i.bonusValue - minB) / bonusRange) * 100 : 0
      score = priceScore * (1 - w) + bonusScore * w
    }
    return { ...i, score: round(score, 2) }
  })
}

/** 生成边际效益分析：以「单价最低」为基准，对比每个更贵的规格是否值得升级 */
export function marginAnalysis(sorted: ComputedSku[]): MarginInsight[] {
  if (sorted.length < 2) return []
  // 基准 = 单价最低者
  const base = [...sorted].sort((a, b) => a.unitPrice - b.unitPrice)[0]
  const out: MarginInsight[] = []

  for (const item of sorted) {
    if (item.id === base.id) continue
    const extraCost = round(item.price - base.price, 2)
    const extraQuantity = round(item.totalQuantity - base.totalQuantity, 2)
    const dropPct =
      base.unitPrice > 0
        ? round(((base.unitPrice - item.unitPrice) / base.unitPrice) * 100, 1)
        : 0
    const worthIt = dropPct > 0 && extraQuantity > 0

    let verdict = ''
    if (extraCost <= 0 && extraQuantity >= 0) {
      verdict = `「${item.name}」更便宜还更多，直接闭眼入。`
    } else if (worthIt) {
      verdict = `多花 ¥${extraCost.toFixed(2)} 多买 ${extraQuantity}${item.unit}，单价再降 ${Math.abs(
        dropPct,
      ).toFixed(1)}%，囤得更狠更划算。`
    } else if (dropPct < 0) {
      verdict = `多花 ¥${extraCost.toFixed(2)}，单价反而上涨 ${Math.abs(
        dropPct,
      ).toFixed(1)}%，性价比倒退，不建议。`
    } else {
      verdict = `多花 ¥${extraCost.toFixed(2)} 但量没多多少，边际收益不明显。`
    }

    out.push({
      fromId: base.id,
      toId: item.id,
      fromName: base.name,
      toName: item.name,
      extraCost,
      extraQuantity,
      unit: item.unit,
      unitPriceDropPct: dropPct,
      worthIt,
      verdict,
    })
  }
  return out
}

/** 生成避坑提示 */
export function buildWarnings(items: ComputedSku[]): string[] {
  const tips: string[] = []
  if (items.length < 2) return tips
  const byPrice = [...items].sort((a, b) => a.unitPrice - b.unitPrice)
  const cheapest = byPrice[0]
  const priciest = byPrice[byPrice.length - 1]

  if (priciest.unitPrice > cheapest.unitPrice * 1.5) {
    tips.push(
      `「${priciest.name}」单价比「${cheapest.name}」贵 ${(
        (priciest.unitPrice / cheapest.unitPrice - 1) *
        100
      ).toFixed(0)}%，除非有特殊需求，否则是明显的智商税。`,
    )
  }

  // 检测「加价不加量」陷阱
  const byTotal = [...items].sort((a, b) => a.totalQuantity - b.totalQuantity)
  for (let i = 1; i < byTotal.length; i++) {
    const prev = byTotal[i - 1]
    const cur = byTotal[i]
    if (cur.price > prev.price && cur.unitPrice > prev.unitPrice) {
      tips.push(
        `「${cur.name}」比「${prev.name}」更贵且单位成本更高，属于「加价又加价率」的双重坑。`,
      )
      break
    }
  }

  // 检测过度囤货
  const maxTotal = Math.max(...items.map((i) => i.totalQuantity))
  const avgTotal = items.reduce((s, i) => s + i.totalQuantity, 0) / items.length
  if (maxTotal > avgTotal * 2.5) {
    tips.push(
      '最大规格的总量远超其他选项，若消耗速度慢，可能面临过期/闲置风险，囤货需量力而行。',
    )
  }

  if (tips.length === 0) {
    tips.push('各规格单价差距不大，按需购买即可，不必为了凑大包装多花钱。')
  }
  return tips
}

/** 推荐理由 */
export function buildReasons(best: ComputedSku, items: ComputedSku[]): string[] {
  const reasons: string[] = []
  const others = items.filter((i) => i.id !== best.id)
  reasons.push(
    `综合得分 ${best.score.toFixed(1)} 分，在 ${items.length} 个规格中排名第一。`,
  )
  reasons.push(
    `每${best.unit}仅 ¥${best.unitPrice.toFixed(4)}（总量 ${best.totalQuantity}${best.unit}），单位成本最低。`,
  )
  if (others.length > 0) {
    const avgOthers =
      others.reduce((s, i) => s + i.unitPrice, 0) / others.length
    const savePct = ((avgOthers - best.unitPrice) / avgOthers) * 100
    if (savePct > 0) {
      reasons.push(`相比其他规格平均单价，再省 ${savePct.toFixed(1)}%。`)
    }
  }
  if (best.bonusValue && best.bonusLabel) {
    reasons.push(
      `附加参数「${best.bonusLabel}」达 ${best.bonusValue}，每元换取 ${best.bonusPerYuan}，硬实力在线。`,
    )
  }
  return reasons
}

/**
 * 按定价因子聚合分簇。
 * 把「quantity × packs × unit 相同」的规格归为一簇——它们价格结构一致，
 * 差异只在口味/颜色等「不影响单价」的干扰维度上。
 * 决策时以簇为单位比价，簇内再挑口味，把 12 选 1 降维成 4 选 1。
 */
export function clusterItems(items: ComputedSku[]): SkuCluster[] {
  const map = new Map<string, ComputedSku[]>()
  for (const item of items) {
    const key = `${item.quantity}|${item.packs}|${item.unit}`
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(item)
  }

  const clusters: SkuCluster[] = []
  for (const [key, members] of map) {
    const sortedMembers = [...members].sort((a, b) => a.unitPrice - b.unitPrice)
    const rep = sortedMembers[0] // 簇内最省钱者作为决策代表
    const prices = members.map((m) => m.price)
    const minPrice = Math.min(...prices)
    const maxPrice = Math.max(...prices)
    const score = Math.max(...members.map((m) => m.score))
    const label = `${fmt.num(rep.quantity)}${rep.unit} × ${rep.packs}件`

    clusters.push({
      key,
      quantity: rep.quantity,
      packs: rep.packs,
      unit: rep.unit,
      members: sortedMembers,
      repUnitPrice: rep.unitPrice,
      minPrice,
      maxPrice,
      priceSpread: round(maxPrice - minPrice, 2),
      score,
      rank: 0,
      isBest: false,
      label,
    })
  }

  return clusters
    .sort((a, b) => b.score - a.score || a.repUnitPrice - b.repUnitPrice)
    .map((c, idx) => ({ ...c, rank: idx + 1, isBest: idx === 0 }))
}

/** 主入口：输入原始 SKU 列表，输出完整决策结果 */
export function decide(skus: Sku[]): DecisionResult {
  const valid = skus.filter((s) => s.price > 0 && s.quantity > 0 && s.packs > 0)
  const computed = valid.map(computeSku)
  const scored = scoreItems(computed)
  const sorted = [...scored].sort((a, b) => b.score - a.score).map((item, idx) => ({
    ...item,
    rank: idx + 1,
    isBest: idx === 0,
  }))

  const best = sorted[0] ?? null
  const baseline =
    sorted.length > 0
      ? [...sorted].sort((a, b) => a.unitPrice - b.unitPrice)[0]
      : null

  const clusters = clusterItems(sorted)
  // 存在「同定价因子、多成员」的簇 → 说明有口味/颜色等干扰维度需要折叠
  const hasVariants = clusters.some((c) => c.members.length > 1)

  return {
    items: sorted,
    best,
    baseline,
    margins: marginAnalysis(sorted),
    warnings: buildWarnings(sorted),
    reasons: best ? buildReasons(best, sorted) : [],
    clusters,
    hasVariants,
  }
}

/** 数字格式化 */
export const fmt = {
  yuan: (n: number) => `¥${n.toFixed(2)}`,
  // 单价：根据数量级自适应精度，避免极小单价（如 ¥0.000041/g）显示成 ¥0.0000
  price4: (n: number) => {
    if (n <= 0) return '¥0'
    if (n >= 0.01) return `¥${n.toFixed(4)}`
    // 极小值：保留足够多的有效位
    return `¥${n.toPrecision(2)}`
  },
  num: (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2)),
  pct: (n: number) => `${n.toFixed(1)}%`,
}

/* ============ 录入表格：口味拆分 + 分组折叠 ============ */

export type GroupBy = 'flavor' | 'quantity' | 'packs'

/**
 * 从规格名称拆出「口味」与「规格描述」。
 * 例："香辣味 16g×8袋" → flavor="香辣味", spec="16g×8袋"
 * 取首个空白/空格前的词作口味；无空格则整段视为规格、口味留空。
 */
export function parseFlavor(name: string): { flavor: string; spec: string } {
  const trimmed = name.trim()
  if (!trimmed) return { flavor: '', spec: '' }
  const m = trimmed.match(/^([^\s　]+)[\s　]+(.+)$/)
  if (m) return { flavor: m[1], spec: m[2].trim() }
  return { flavor: '', spec: trimmed }
}

/** 按指定维度对 SKU 分组（用于录入表格的折叠展示） */
export function groupSkus(skus: Sku[], by: GroupBy): Array<{ key: string; items: Sku[] }> {
  const map = new Map<string, Sku[]>()
  for (const s of skus) {
    let key = ''
    if (by === 'flavor') key = parseFlavor(s.name).flavor || '（无口味）'
    else if (by === 'quantity') key = `${s.quantity}${s.unit}`
    else key = `${s.packs}件`
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
}

/**
 * 从规格描述解析结构化字段。
 * 支持："38g×20袋" "16g*8袋" "16gx8" "500ml×6" "8+128" 等。
 * 例："38g×20袋" → { quantity:38, unit:'g', packs:20 }
 */
export function parseSpec(spec: string): Partial<SpecParts> {
  const t = spec.trim()
  if (!t) return {}
  // 主模式：数字+单位 ×/x/*/× 数字
  const m = t.match(/(\d+(?:\.\d+)?)\s*([a-zA-Z\u4e00-\u9fa5]*)\s*[×xX*]\s*(\d+(?:\.\d+)?)/)
  if (m) {
    return {
      quantity: parseFloat(m[1]),
      unit: m[2] || '',
      packs: Math.max(1, Math.round(parseFloat(m[3]))),
    }
  }
  // 退化：仅 "数字+单位"（无件数）
  const m2 = t.match(/(\d+(?:\.\d+)?)\s*([a-zA-Z\u4e00-\u9fa5]+)/)
  if (m2) return { quantity: parseFloat(m2[1]), unit: m2[2] }
  return {}
}

/**
 * 由结构化字段拼出规格描述。
 * 例：{ quantity:38, unit:'g', packs:20 } → "38g×20袋"
 */
export function buildSpec(quantity: number, unit: string, packs: number): string {
  if (!(quantity > 0)) return ''
  const q = Number.isInteger(quantity) ? String(quantity) : String(quantity)
  const p = packs > 0 ? packs : 1
  return `${q}${unit}×${p}袋`
}
