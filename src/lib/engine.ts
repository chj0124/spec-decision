import type {
  ComputedSku,
  DecisionConfig,
  DecisionResult,
  MarginGrade,
  MarginInsight,
  ParamDim,
  ParamValue,
  Preference,
  Sku,
  SkuCluster,
} from './types'

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
  const safePacks = Math.max(1, s.packs)
  const totalQuantity = round(norm.value * safePacks, 4)
  // 单价 = 总价 / 基准单位总量（单位统一后跨规格可比）
  const unitPrice = totalQuantity > 0 ? round(s.price / totalQuantity, 6) : 0
  // 每包价格 = 总价 / 件数（"包"对消费者比每g更直观，常用于"一袋多少钱"）
  const packPrice = round(s.price / safePacks, 2)
  const bonusPerYuan =
    s.bonusValue && s.price > 0 ? round(s.bonusValue / s.price, 4) : undefined
  return {
    ...s,
    // unit 统一显示为基准单位，保证下游（报告/分簇/图表）口径一致
    unit: norm.base || s.unit,
    totalQuantity,
    unitPrice,
    packPrice,
    bonusPerYuan,
    score: 0,
    rank: 0,
    isBest: false,
  }
}

/** 把单个维度的原始取值归一化到 0-100 分 */
function scoreDim(
  dim: ParamDim,
  value: ParamValue,
  range: { min: number; max: number } | null,
): number {
  if (dim.type === 'boolean') {
    // 兼容字符串 'yes'/'no' 与历史布尔值
    return value === 'yes' || (typeof value === 'boolean' && value) ? 100 : 0
  }
  if (dim.type === 'text') {
    const levels = dim.levels ?? []
    if (levels.length === 0) return 50
    const idx = levels.indexOf(String(value))
    if (idx < 0) return 0
    // 第 0 名得 100，最后一名得接近 0
    return range && range.max > range.min
      ? ((range.max - idx) / (range.max - range.min)) * 100
      : 100 - (idx / Math.max(1, levels.length - 1)) * 100
  }
  // 数值型：higher-better / lower-better
  if (typeof value !== 'number' || !range || range.max <= range.min) return 50
  if (dim.type === 'higher-better') {
    return ((value - range.min) / (range.max - range.min)) * 100
  }
  // lower-better
  return ((range.max - value) / (range.max - range.min)) * 100
}

/**
 * 多维度加权评分：
 *  - 价格维度（单价越低越好）权重 = config.priceWeight
 *  - 每个 ParamDim 按其 type 归一化到 0-100，再按 weight 加权
 *  - 总权重 = priceWeight + ∑dim.weight，做归一化避免权重不等于 100 时失真
 * 返回 0-100 分，越高越划算。
 */
export function scoreItems(
  items: ComputedSku[],
  config: DecisionConfig,
): ComputedSku[] {
  if (items.length === 0) return items

  // 价格维度范围
  const prices = items.map((i) => i.unitPrice).filter((p) => p > 0)
  const minP = Math.min(...prices)
  const maxP = Math.max(...prices)
  const priceRange = maxP - minP || 1

  // 各数值维度的取值范围（text 类型用索引范围）
  const dimRanges = new Map<string, { min: number; max: number } | null>()
  for (const dim of config.dims) {
    if (dim.type === 'boolean') {
      dimRanges.set(dim.id, null)
      continue
    }
    if (dim.type === 'text') {
      const levels = dim.levels ?? []
      dimRanges.set(dim.id, { min: 0, max: Math.max(0, levels.length - 1) })
      continue
    }
    const vals = items
      .map((i) => i.params?.[dim.id])
      .filter((v): v is number => typeof v === 'number' && !isNaN(v))
    if (vals.length === 0) {
      dimRanges.set(dim.id, null)
      continue
    }
    dimRanges.set(dim.id, { min: Math.min(...vals), max: Math.max(...vals) })
  }

  // 总权重（防 0）
  const totalW =
    Math.max(0, config.priceWeight) +
    config.dims.reduce((s, d) => s + Math.max(0, d.weight), 0) || 1

  return items.map((i) => {
    const dimScores: Record<string, number> = {}

    // 价格分（0-100，越低越高）
    const priceScore = i.unitPrice > 0 ? ((maxP - i.unitPrice) / priceRange) * 100 : 0
    dimScores['price'] = round(priceScore, 2)

    let weightedSum = priceScore * (Math.max(0, config.priceWeight) / totalW)

    for (const dim of config.dims) {
      const v = i.params?.[dim.id]
      const range = dimRanges.get(dim.id) ?? null
      const s = scoreDim(dim, v, range)
      dimScores[dim.id] = round(s, 2)
      weightedSum += s * (Math.max(0, dim.weight) / totalW)
    }

    return { ...i, dimScores, score: round(weightedSum, 2) }
  })
}

/**
 * 取规格的短名用于结论文案：优先用 parseFlavor 拆出的 spec 部分（如 "16g×8袋"），
 * spec 太长或缺失时退化为结构化字段拼接，保证关键规格信息始终可见。
 */
function shortName(s: ComputedSku): string {
  const { flavor, spec } = parseFlavor(s.name)
  if (spec && spec.length <= 20) return spec
  if (flavor && spec) return spec.length > 20 ? `${s.quantity}${s.unit}×${s.packs}件` : spec
  // 无 flavor 或无 spec：用结构化字段
  return `${s.quantity}${s.unit}×${s.packs}件`
}

/**
 * 生成边际效益分析：真正的"边际"——相邻包装档位对比。
 *
 * 1) 先合并仅口味/颜色不同（同 price + totalQuantity + unit）的条目
 * 2) 按总量升序排列
 * 3) 每个档位和前一个档位对比：升级到这一档多花多少钱、多得多少量、单价降多少
 *    这才是"边际效益"——每一步升级值不值，而非所有都和最小包装比
 *
 * 分级逻辑（基于相邻对比的单价变化）：
 * - great  闭眼入：更便宜还更多，或单价降幅 > 15%
 * - good   划算：单价降幅 3%-15%
 * - fair   持平：单价变化在 ±3% 以内
 * - poor   小亏：单价涨幅 3%-10%
 * - bad    不建议：单价涨幅 > 10%
 */
export function marginAnalysis(sorted: ComputedSku[]): MarginInsight[] {
  if (sorted.length < 2) return []

  // 1) 合并同价同规格（仅口味/颜色不同）的条目
  const merged = mergeVariantSkus(sorted)
  if (merged.length < 2) return []

  const out: MarginInsight[] = []
  // 2) 相邻对比：每个档位 vs 前一个档位
  for (let i = 1; i < merged.length; i++) {
    const base = merged[i - 1]
    const item = merged[i]
    const extraCost = round(item.price - base.price, 2)
    const extraQuantity = round(item.totalQuantity - base.totalQuantity, 2)
    const dropPct =
      base.unitPrice > 0
        ? round(((base.unitPrice - item.unitPrice) / base.unitPrice) * 100, 1)
        : 0
    const marginalSaving = round(base.unitPrice - item.unitPrice, 6)
    // 净省/净亏：多得的量按前档单价折算价值 - 多花的钱。直观反映"买这个总共能省多少"
    const netSaving = round(extraQuantity * base.unitPrice - extraCost, 2)

    // 分级
    let grade: MarginGrade
    if (extraCost <= 0 && extraQuantity > 0) {
      grade = 'great'
    } else if (dropPct > 15) {
      grade = 'great'
    } else if (dropPct > 3) {
      grade = 'good'
    } else if (dropPct >= -3) {
      grade = 'fair'
    } else if (dropPct >= -10) {
      grade = 'poor'
    } else {
      grade = 'bad'
    }

    // 结论文案用短名（规格部分），避免长规格名被截断后关键信息丢失
    const baseShort = shortName(base)
    // 三段式表述：①比前档贵多少 ②多换到多少量 ③每单位省/贵多少钱
    // 例："比「16g×4袋」贵 ¥3.56，多 160g，每 g 省 2.23 分，划算。"
    // 用过滤+join 避免某段为空时出现连续逗号
    const costStr = `比「${baseShort}」贵 ${fmt.yuan(extraCost)}`
    const qtyStr = extraQuantity > 0 ? `多 ${extraQuantity}${item.unit}` : ''
    const marginStr = marginalSaving > 0
      ? `每${item.unit}省 ${fmt.priceUnit(marginalSaving)}`
      : marginalSaving < 0
        ? `每${item.unit}反贵 ${fmt.priceUnit(Math.abs(marginalSaving))}`
        : `每${item.unit}持平`
    const tail = grade === 'great' ? '超值'
      : grade === 'good' ? '划算'
      : grade === 'fair' ? '看需求选'
      : grade === 'poor' ? '不划算'
      : '别买'
    const body = [costStr, qtyStr, marginStr].filter(Boolean).join('，')
    const verdict = grade === 'great' && extraCost <= 0
      ? `比「${baseShort}」更便宜还更多，直接闭眼入。`
      : `${body}，${tail}。`

    out.push({
      fromId: base.id,
      toId: item.id,
      fromName: base.name,
      toName: item.name,
      extraCost,
      extraQuantity,
      unit: item.unit,
      unitPriceDropPct: dropPct,
      marginalSaving,
      netSaving,
      grade,
      worthIt: grade === 'great' || grade === 'good',
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
    `每${best.unit}仅 ${fmt.priceUnit(best.unitPrice)}（总量 ${best.totalQuantity}${best.unit}），单位成本最低。`,
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
 * 根据商品类型推断"口味列"应显示的列名。
 * 这列本质是 SKU 名称里拆出的第一个词（parseFlavor），对零食是口味，对数码是颜色，对五金是型号。
 */
export function inferFlavorLabel(category?: string): string {
  const c = (category ?? '').trim()
  if (!c) return '口味'
  // 五金/螺丝/工具 → 型号
  if (/螺丝|五金|工具|配件|零件|紧固|螺母|螺栓|垫片|轴承/i.test(c)) return '型号'
  // 手机/电脑/数码 → 颜色
  if (/手机|电脑|数码|电子|平板|笔记本|相机|耳机|充电/i.test(c)) return '颜色'
  // 服装/鞋帽 → 款式
  if (/服装|衣服|鞋|帽|袜|穿搭|外套|裤子|裙/i.test(c)) return '款式'
  // 洗护/美妆 → 香型
  if (/洗护|美妆|护肤|香水|洗发|沐浴|牙膏|洗衣/i.test(c)) return '香型'
  // 食品/零食/饮料/生鲜等 → 口味（覆盖坚果、蜜饯、膨化、肉脯、糕点等细分品类）
  if (/零食|食品|饮料|吃的|茶叶|咖啡|坚果|蜜饯|膨化|肉脯|糕点|饼干|糖果|巧克力|方便面|挂面|调味|酱|罐头|水果|生鲜|乳|奶|茶|酒|水/i.test(c)) return '口味'
  // 默认：食品是最常见场景，用"口味"
  return '口味'
}

/**
 * 合并仅口味/颜色不同的 SKU（同 price + totalQuantity + unit）。
 * 合并后 name 为"口味1/口味2/口味3 规格"，保留规格信息。
 * 用于边际效益分析，避免同价同规格的条目重复列出。
 */
export function mergeVariantSkus(sorted: ComputedSku[]): ComputedSku[] {
  const groups = new Map<string, ComputedSku[]>()
  for (const s of sorted) {
    const key = `${s.price}|${s.totalQuantity}|${s.unit}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(s)
  }
  const merged: ComputedSku[] = []
  for (const members of groups.values()) {
    if (members.length === 1) {
      merged.push(members[0])
    } else {
      // 提取每个 SKU 的口味部分，合并显示
      const flavors: string[] = []
      let spec = ''
      for (const m of members) {
        const { flavor, spec: s } = parseFlavor(m.name)
        if (flavor) flavors.push(flavor)
        if (!spec) spec = s
      }
      const rep = { ...members[0] }
      if (flavors.length > 0 && spec) {
        rep.name = `${flavors.join('/')} ${spec}`
      } else {
        rep.name = `${members[0].name} 等${members.length}种`
      }
      merged.push(rep)
    }
  }
  return merged.sort((a, b) => a.totalQuantity - b.totalQuantity)
}

/**
 * 把「quantity × packs × unit 相同、且参数维度也相同」的规格归为一簇——
 * 它们才是同一款商品，差异只在口味/颜色等「不影响单价」的干扰维度上。
 * 决策时以簇为单位比价，簇内再挑口味，把 12 选 1 降维成 4 选 1。
 *
 * 关键：聚类 key 必须包含参数签名。否则同一存储/含量下若出现参数不同的商品
 * （如 256GB 手机有 12G/8G 内存、不同电池），会被误并成一簇、当成"同款不同口味"，
 * 掩盖真实的规格/价格差异。只有参数完全一致（仅干扰维度不同）才合并。
 */
function paramSignature(params?: Record<string, ParamValue>): string {
  if (!params) return ''
  return Object.keys(params)
    .sort()
    .map((k) => `${k}=${JSON.stringify(params[k])}`)
    .join('&')
}

export function clusterItems(items: ComputedSku[]): SkuCluster[] {
  const map = new Map<string, ComputedSku[]>()
  for (const item of items) {
    const key = `${item.quantity}|${item.packs}|${item.unit}|${paramSignature(item.params)}`
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

/** 按决策偏好排序，返回带 rank/isBest 的列表 */
function rankByPreference(
  scored: ComputedSku[],
  preference: Preference,
  budget?: number,
): ComputedSku[] {
  let pool = scored
  if (preference === 'budget' && typeof budget === 'number' && budget > 0) {
    pool = scored.filter((i) => i.price <= budget!)
  }
  const cmp =
    preference === 'value'
      ? (a: ComputedSku, b: ComputedSku) => a.unitPrice - b.unitPrice // 性价比优先
      : (a: ComputedSku, b: ComputedSku) => b.score - a.score // 综合/预算优先均按 score
  return [...pool].sort(cmp).map((item, idx) => ({
    ...item,
    rank: idx + 1,
    isBest: idx === 0,
  }))
}

/** 主入口：输入原始 SKU 列表 + 决策配置，输出完整决策结果 */
export function decide(skus: Sku[], config: DecisionConfig): DecisionResult {
  const valid = skus.filter((s) => s.price > 0 && s.quantity > 0 && s.packs > 0)
  const computed = valid.map(computeSku)
  const scored = scoreItems(computed, config)
  const sorted = rankByPreference(scored, config.preference, config.budget)

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
  /**
   * 单价友好显示：根据数值大小自适应精度，避免一串小数零或多余小数位。
   * - < 0.1 元：改用"分"表达，如 0.0257 → "2.57分"
   * - 0.1 ~ 1 元：保留4位小数，如 0.5234 → "¥0.5234"
   * - ≥ 1 元：保留2位小数，如 89.9 → "¥89.90"
   */
  priceUnit: (n: number) => {
    if (n <= 0) return '0分'
    if (n < 0.1) return `${(n * 100).toFixed(2)}分`
    if (n < 1) return `¥${n.toFixed(4)}`
    return `¥${n.toFixed(2)}`
  },
  num: (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2)),
  pct: (n: number) => `${n.toFixed(1)}%`,
}

/* ============ 录入表格：口味拆分 + 分组折叠 ============ */

export type GroupBy = 'flavor' | 'quantity' | 'packs' | `dim:${string}`

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
