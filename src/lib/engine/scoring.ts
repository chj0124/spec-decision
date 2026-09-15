import type {
  ComputedSku,
  DecisionConfig,
  MarginGrade,
  MarginInsight,
  ParamDim,
  ParamValue,
  Sku,
  WarningPair,
} from '../types'
import { round, fmt, displayUnit, displayQuantity, displayUnitPrice } from './util'
import { normalizeUnit } from './units'
import { parseFlavor } from './spec'

/* ============ 单 SKU 派生计算 ============ */

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

/* ============ 多维度加权评分 ============ */

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

/* ============ 边际效益分析 ============ */

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
    const qtyStr = extraQuantity > 0
      ? `多 ${fmt.num(displayQuantity(extraQuantity, item.unit))}${displayUnit(item.unit)}`
      : ''
    const showUnit = displayUnit(item.unit)
    const marginStr = marginalSaving > 0
      ? `每${showUnit}省 ${fmt.priceUnit(displayUnitPrice(marginalSaving, item.unit))}`
      : marginalSaving < 0
        ? `每${showUnit}反贵 ${fmt.priceUnit(displayUnitPrice(Math.abs(marginalSaving), item.unit))}`
        : `每${showUnit}持平`
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

/* ============ 提示与结论文案 ============ */

/**
 * 生成避坑提示，并区分「能不能连成一条线」：
 * - pairs：针对某两条规格的对比（智商税 / 加价不加量），带两条规格的 id，
 *   报告页可在主视觉里把这两条横条用虚线连起来再挂文字；
 * - notes：不针对某两条规格的提醒（过度囤货 / 差距不大），只能以文字呈现。
 * 调用方要保证传入的 items 与图表所用的是同一份（同价同规格口味已合并），
 * 否则 id 对不上，图上的连线会找不到横条。
 */
export function buildWarningsStructured(items: ComputedSku[]): {
  pairs: WarningPair[]
  notes: string[]
} {
  const pairs: WarningPair[] = []
  const notes: string[] = []
  if (items.length < 2) return { pairs, notes }
  // 同一条"更贵 → 更便宜"的对照只留一次：两条规则（智商税 / 加价不加量）在小样本下
  // 常常命中同一对规格，若都收录，图上会在同一处叠两条虚线和两个编号。
  const seen = new Set<string>()
  const push = (p: WarningPair) => {
    const key = `${p.fromId}>${p.toId}`
    if (seen.has(key)) return
    seen.add(key)
    pairs.push(p)
  }
  const byPrice = [...items].sort((a, b) => a.unitPrice - b.unitPrice)
  const cheapest = byPrice[0]
  const priciest = byPrice[byPrice.length - 1]

  if (priciest.unitPrice > cheapest.unitPrice * 1.5) {
    const pct = Math.round((priciest.unitPrice / cheapest.unitPrice - 1) * 100)
    push({
      fromId: priciest.id,
      toId: cheapest.id,
      pct,
      text: `「${priciest.name}」单价比「${cheapest.name}」贵 ${pct}%，除非有特殊需求，否则是明显的智商税。`,
    })
  }

  // 检测「加价不加量」陷阱
  const byTotal = [...items].sort((a, b) => a.totalQuantity - b.totalQuantity)
  for (let i = 1; i < byTotal.length; i++) {
    const prev = byTotal[i - 1]
    const cur = byTotal[i]
    if (cur.price > prev.price && cur.unitPrice > prev.unitPrice) {
      push({
        fromId: cur.id,
        toId: prev.id,
        pct: Math.round((cur.unitPrice / prev.unitPrice - 1) * 100),
        text: `「${cur.name}」比「${prev.name}」更贵且单位成本更高，属于「加价又加价率」的双重坑。`,
      })
      break
    }
  }

  // 检测过度囤货
  const maxTotal = Math.max(...items.map((i) => i.totalQuantity))
  const avgTotal = items.reduce((s, i) => s + i.totalQuantity, 0) / items.length
  if (maxTotal > avgTotal * 2.5) {
    notes.push(
      '最大规格的总量远超其他选项，若消耗速度慢，可能面临过期/闲置风险，囤货需量力而行。',
    )
  }

  if (pairs.length === 0 && notes.length === 0) {
    notes.push('各规格单价差距不大，按需购买即可，不必为了凑大包装多花钱。')
  }
  return { pairs, notes }
}

/** 取「可连线」的那部分避坑提示（主视觉画虚线用） */
export function buildWarningPairs(items: ComputedSku[]): WarningPair[] {
  return buildWarningsStructured(items).pairs
}

/** 取「只能以文字呈现」的那部分避坑提示 */
export function buildWarningNotes(items: ComputedSku[]): string[] {
  return buildWarningsStructured(items).notes
}

/** 生成避坑提示（纯文本全量，供复制摘要等使用） */
export function buildWarnings(items: ComputedSku[]): string[] {
  const { pairs, notes } = buildWarningsStructured(items)
  return [...pairs.map((p) => p.text), ...notes]
}

/** 推荐理由 */
export function buildReasons(best: ComputedSku, items: ComputedSku[]): string[] {
  const reasons: string[] = []
  const others = items.filter((i) => i.id !== best.id)
  reasons.push(
    `综合得分 ${best.score.toFixed(1)} 分，在 ${items.length} 个规格中排名第一。`,
  )
  reasons.push(
    `每${displayUnit(best.unit)}仅 ${fmt.priceUnit(displayUnitPrice(best.unitPrice, best.unit))}` +
    `（总量 ${fmt.num(displayQuantity(best.totalQuantity, best.unit))}${displayUnit(best.unit)}），单位成本最低。`,
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

/* ============ 口味列名推断 + 同款合并 ============ */

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
