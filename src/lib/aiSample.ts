// AI 自动生成示例：删除所有静态示例后，提供一个按钮一键生成"逼真"的多 SKU 决策示例。
// 若用户已配置 AI → 调用 chat() 生成（每次随机品类，贴近真实市场）；
// 若未配置或生成失败 → 回退到内置的 4 套真实商品模板（蓝牙耳机 / 机械键盘 / 行李箱 / 猫粮），
//   模板数据来自真实在售商品调研（价格区间、规格、参数维度均贴近现实）。

import type { Sku, DecisionConfig, ParamDim, ParamValue } from './types'
import { uid } from './engine'
import { chat, isAiReady } from './ai'

export interface GeneratedExample {
  skus: Sku[]
  config: DecisionConfig
  /** 'ai' = AI 实时生成；'fallback' = 内置模板兜底（未配置 AI 或 AI 失败） */
  source: 'ai' | 'fallback'
  /** 回退时的友好说明（含真实失败原因），用于 UI 提示 */
  note?: string
  /** 生成结果的简要介绍（商品品类、SKU 数、维度构成），让用户一眼知道生成了什么 */
  summary: string
}

const clamp = (n: number, lo: number, hi: number, dflt: number) => {
  const v = Number(n)
  if (!Number.isFinite(v)) return dflt
  return Math.min(hi, Math.max(lo, v))
}
const round2 = (n: number) => Math.round(n * 100) / 100
/** 价格轻微抖动（±4%），让每次示例都不完全一样，更像真实数据 */
const jitter = (base: number, pct = 0.04) => round2(base * (1 + (Math.random() * 2 - 1) * pct))

// ============ 内置真实商品模板（回退用） ============
type Template = () => { skus: Sku[]; config: DecisionConfig }

/** 蓝牙耳机：3 配色 × 4 型号 = 12 SKU，参数含降噪/续航/防水/单耳重量 */
const earbuds: Template = () => {
  const colors = ['曜石黑', '月光白', '晨曦金']
  const models: [number, number, number, number, number, string][] = [
    // [降噪dB, 续航h, IPX等级, 单耳重量g, 基础价, 型号名]
    [42, 32, 4, 4.5, 259, '入门款'],
    [48, 40, 5, 4.8, 387, '标准款'],
    [55, 48, 5, 5.0, 499, '旗舰款'],
    [52, 36, 4, 6.0, 899, '轻奢款'],
  ]
  const ipxLevels = ['IPX3', 'IPX4', 'IPX5']
  const skus: Sku[] = []
  for (const [anc, bat, ipx, w, price, model] of models) {
    for (const c of colors) {
      skus.push({
        id: uid(),
        name: `${c} ${model} ${anc}dB降噪`,
        price: jitter(price),
        quantity: 1,
        unit: '副',
        packs: 1,
        params: { anc, 续航: bat, 防水: `IPX${ipx}`, 单耳重量: w },
      })
    }
  }
  return {
    skus,
    config: {
      dims: [
        { id: 'anc', label: '降噪深度', type: 'higher-better', weight: 30, unit: 'dB' },
        { id: '续航', label: '续航', type: 'higher-better', weight: 25, unit: 'h' },
        { id: '防水', label: '防水等级', type: 'text', weight: 15, levels: ipxLevels },
        { id: '单耳重量', label: '单耳重量', type: 'lower-better', weight: 10, unit: 'g' },
      ],
      priceWeight: 40,
      preference: 'score',
      category: '蓝牙耳机',
      flavorLabel: '颜色',
    },
  }
}

/** 机械键盘：5 配列 × 3 轴体 = 15 SKU，参数含配列/轴体/连接/电池 */
const keyboard: Template = () => {
  const switches = ['红轴', '茶轴', '青轴']
  const layouts: [string, number, number, string][] = [
    // [配列标签, 电池mAh, 基础价, 连接]
    ['60% 紧凑', 2000, 229, '三模'],
    ['65% 便携', 3000, 259, '三模'],
    ['75% 标准', 4000, 329, '三模'],
    ['96% 全功能', 4000, 469, '三模'],
    ['104键 全尺寸', 1000, 199, '双模'],
  ]
  const layoutLevels = ['60%', '65%', '75%', '96%', '104键']
  const skus: Sku[] = []
  for (const [layout, bat, price, conn] of layouts) {
    for (const sw of switches) {
      skus.push({
        id: uid(),
        name: `${layout} ${sw} ${conn}`,
        price: jitter(price),
        quantity: 1,
        unit: '把',
        packs: 1,
        params: { 配列: layout.split(' ')[0], 轴体: sw, 连接: conn, 电池: bat },
      })
    }
  }
  return {
    skus,
    config: {
      dims: [
        { id: '配列', label: '配列', type: 'text', weight: 25, levels: layoutLevels },
        { id: '轴体', label: '轴体', type: 'text', weight: 20, levels: switches },
        { id: '连接', label: '连接方式', type: 'text', weight: 15, levels: ['双模', '三模'] },
        { id: '电池', label: '电池容量', type: 'higher-better', weight: 15, unit: 'mAh' },
      ],
      priceWeight: 35,
      preference: 'score',
      category: '机械键盘',
      flavorLabel: '配列',
    },
  }
}

/** 行李箱：3 颜色 × 5 规格 = 15 SKU，参数含材质/净重/TSA锁（寸为含量单位） */
const luggage: Template = () => {
  const colors = ['远峰蓝', '石墨灰', '象牙白']
  const specs: [number, string, number, number, boolean][] = [
    // [尺寸寸, 材质, 净重kg, 基础价, TSA锁]
    [20, 'PC', 2.6, 299, true],
    [24, 'PC', 3.0, 399, true],
    [28, 'PC+ABS', 3.5, 499, true],
    [24, '铝镁合金', 3.2, 899, true],
    [28, '铝镁合金', 3.8, 1299, true],
  ]
  const matLevels = ['PC', 'PC+ABS', '铝镁合金']
  const skus: Sku[] = []
  for (const [size, mat, weight, price, tsa] of specs) {
    for (const c of colors) {
      skus.push({
        id: uid(),
        name: `${c} ${size}寸 ${mat}`,
        price: jitter(price),
        quantity: size,
        unit: '寸',
        packs: 1,
        params: { 材质: mat, 净重: weight, TSA锁: tsa ? 'yes' : 'no' },
      })
    }
  }
  return {
    skus,
    config: {
      dims: [
        { id: '材质', label: '材质', type: 'text', weight: 25, levels: matLevels },
        { id: '净重', label: '净重', type: 'lower-better', weight: 20, unit: 'kg' },
        { id: 'TSA锁', label: 'TSA海关锁', type: 'boolean', weight: 10 },
      ],
      priceWeight: 45,
      preference: 'score',
      category: '行李箱',
      flavorLabel: '颜色',
    },
  }
}

/** 猫粮：3 口味 × 5 规格 = 15 SKU，参数含粗蛋白/无谷（kg 为含量单位） */
const catfood: Template = () => {
  const flavors = ['鸡肉', '鱼肉', '牛肉']
  const specs: [number, number, number, boolean][] = [
    // [净含量kg, 粗蛋白%, 基础价, 无谷]
    [1.5, 40, 96, true],
    [5, 38, 159, false],
    [10, 36, 190, false],
    [5, 45, 279, true],
    [10, 42, 329, true],
  ]
  const skus: Sku[] = []
  for (const [kg, protein, price, grainFree] of specs) {
    for (const f of flavors) {
      skus.push({
        id: uid(),
        name: `${f} ${kg}kg`,
        price: jitter(price),
        quantity: kg,
        unit: 'kg',
        packs: 1,
        params: { 粗蛋白: protein, 无谷: grainFree ? 'yes' : 'no' },
      })
    }
  }
  return {
    skus,
    config: {
      dims: [
        { id: '粗蛋白', label: '粗蛋白', type: 'higher-better', weight: 35, unit: '%' },
        { id: '无谷', label: '无谷配方', type: 'boolean', weight: 15 },
      ],
      priceWeight: 40,
      preference: 'score',
      category: '猫粮',
      flavorLabel: '口味',
    },
  }
}

const FALLBACKS: Template[] = [earbuds, keyboard, luggage, catfood]

function pickFallback(): { skus: Sku[]; config: DecisionConfig } {
  const tpl = FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)]
  return tpl()
}

// ============ AI 实时生成路径 ============
const CATEGORY_HINTS = [
  '蓝牙耳机', '机械键盘', '行李箱', '猫粮', '保温杯', '运动水壶', '抽纸',
  '洗衣液', '充电宝', '瑜伽垫', '猫砂', '咖啡豆', '坚果', '面膜', '保温饭盒', '羽毛球拍',
]

const SYS_PROMPT =
  '你是一名严谨的电商选品分析师，擅长构造贴近真实市场的多 SKU 比价数据。' +
  '只输出一个 JSON 对象，不要任何解释、不要 markdown 代码块、不要多余文字。' +
  '字段必须严格符合下方要求的 schema。'

function buildUserPrompt(hint: string): string {
  return `请构造一份「${hint}」或其他你熟悉的常见消费品类的多 SKU 比价决策示例，要求尽可能逼真、贴近真实电商在售商品：

1. 8~16 个 SKU，覆盖 2~4 种口味/颜色/型号（第一分组维度）与 2~5 种规格（含量/尺寸/件数）。
2. 价格用真实市场人民币（可带小数，如 259.9），单位用常见单位（g/ml/kg/L/片/个/把/副/cm/寸/英寸/包 等）。
3. 设定 3~5 个参数维度 dims，类型可为 higher-better / lower-better / boolean / text，权重 0~100（数字）；数值维度可带 unit。
4. 每个 dim 用一个稳定的短英文 id（如 "anc"/"battery"/"waterproof"），并在每个 sku 的 params 中用同一个 id 作为 key 填值；label 用中文。
5. 每个 sku 的 name 必须为 "口味/颜色/型号 规格描述" 形式，第一个空格前的词会被识别为分组列，例如 "巧克力 450g×1罐"、"曜石黑 旗舰款 55dB降噪"、"60% 红轴 三模"。
6. text 类型维度的 levels 数组按"从优到劣"排列；boolean 维度值用 true/false。

返回 JSON，schema 如下（不要任何额外字段）：
{
  "category": "商品品类（中文，如 蓝牙耳机）",
  "flavorLabel": "第一分组的列名（如 口味/颜色/型号/配列）",
  "priceWeight": 40,
  "preference": "score",
  "dims": [{"id":"...","label":"...","type":"higher-better|lower-better|boolean|text","weight":30,"unit":"可选","levels":["可选，仅text"]}],
  "skus": [
    {"name":"...","price":259.9,"quantity":1,"unit":"副","packs":1,"params":{"anc":55}}
  ]
}`
}

/** 从 AI 文本里抠出 JSON（兼容代码块、前后多余文字） */
function extractJson(text: string): any {
  let t = (text || '').trim()
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const s = t.indexOf('{')
  const e = t.lastIndexOf('}')
  if (s >= 0 && e > s) t = t.slice(s, e + 1)
  return JSON.parse(t)
}

const VALID_TYPES = ['higher-better', 'lower-better', 'boolean', 'text']

/** 清洗 AI 输出，保证字段合法、dim.id 与 params.key 严格一致 */
function sanitize(raw: any): { skus: Sku[]; config: DecisionConfig } {
  if (!raw || !Array.isArray(raw.skus) || raw.skus.length === 0) {
    throw new Error('AI 返回格式错误：缺少 skus 数组')
  }
  const dimsIn: any[] = Array.isArray(raw.dims) ? raw.dims : []
  const dims: ParamDim[] = dimsIn
    .filter((d) => d && d.id)
    .map((d) => {
      const type = VALID_TYPES.includes(d.type) ? d.type : 'higher-better'
      const dim: ParamDim = {
        id: String(d.id),
        label: d.label ? String(d.label) : String(d.id),
        type,
        weight: clamp(d.weight, 0, 100, 20),
      }
      if (type === 'higher-better' || type === 'lower-better') {
        if (d.unit) dim.unit = String(d.unit)
      }
      if (type === 'text' && Array.isArray(d.levels) && d.levels.length) {
        dim.levels = d.levels.map((x: any) => String(x))
      }
      return dim
    })

  const dimIds = new Set(dims.map((d) => d.id))
  const skus: Sku[] = (raw.skus as any[])
    .map((s): Sku | null => {
      if (!s || typeof s !== 'object') return null
      const price = Number(s.price)
      const quantity = Number(s.quantity)
      const packs = Number(s.packs)
      if (!(price > 0) || !(quantity > 0)) return null
      const params: Record<string, ParamValue> = {}
      if (s.params && typeof s.params === 'object') {
        for (const id of dimIds) {
          const v = (s.params as Record<string, any>)[id]
          if (v === undefined || v === null || v === '') continue
          if (typeof v === 'number') params[id] = v
          else if (typeof v === 'boolean') params[id] = v ? 'yes' : 'no'
          else params[id] = String(v)
        }
      }
      return {
        id: uid(),
        name: String(s.name ?? '').slice(0, 60),
        price: round2(price),
        quantity,
        unit: String(s.unit ?? '个').slice(0, 8),
        packs: Math.max(1, Math.round(packs || 1)),
        params,
      }
    })
    .filter((x): x is Sku => x !== null)

  if (skus.length < 3) throw new Error('AI 生成的 SKU 数量过少（需 ≥ 3）')

  // text 维度：把 sku 实际出现的值补进 levels，保证下拉选项齐全
  for (const dim of dims) {
    if (dim.type !== 'text') continue
    const present = new Set<string>()
    for (const s of skus) {
      const v = s.params?.[dim.id]
      if (typeof v === 'string' && v) present.add(v)
    }
    const given = dim.levels ?? []
    dim.levels = [...given, ...[...present].filter((v) => !given.includes(v))]
    if (dim.levels.length === 0) dim.levels = undefined
  }

  const config: DecisionConfig = {
    dims,
    priceWeight: clamp(raw.priceWeight, 0, 100, 50),
    preference: raw.preference === 'score' || raw.preference === 'budget' ? raw.preference : 'value',
    category: raw.category ? String(raw.category).slice(0, 20) : undefined,
    flavorLabel: raw.flavorLabel ? String(raw.flavorLabel).slice(0, 10) : undefined,
  }
  return { skus, config }
}

async function generateViaAi(): Promise<{ skus: Sku[]; config: DecisionConfig }> {
  const hint = CATEGORY_HINTS[Math.floor(Math.random() * CATEGORY_HINTS.length)]
  // 禁用豆包推理模式（thinking:{"type":"disabled"}）：实测把复杂生成任务的思考耗时从 ~97s 砍到 ~15s，
  // 避免压垮 90s 超时；其他 OpenAI 兼容服务商会忽略此参数，无副作用。生成类任务不需要长链推理。
  // 生成专用超时放宽到 150s 作为安全垫（正常 ~15s 即可返回）。
  const text = await chat(
    buildUserPrompt(hint),
    SYS_PROMPT,
    undefined,
    { thinking: { type: 'disabled' } },
    150000,
  )
  const parsed = extractJson(text)
  return sanitize(parsed)
}

/**
 * 根据 config + skus 本地拼装一句简介，让用户一眼知道生成了什么。
 * 不依赖 AI 返回 summary 字段（AI 不一定遵守），用结构化数据拼装更可靠。
 */
function buildSummary(skus: Sku[], config: DecisionConfig): string {
  const category = config.category || '商品'
  const dimLabels = config.dims.map((d) => d.label).filter(Boolean)
  const dimPart = dimLabels.length > 0
    ? `，${dimLabels.length} 个参数维度（${dimLabels.join('、')}）`
    : ''
  return `已加载「${category}」示例：${skus.length} 个 SKU${dimPart}`
}

/**
 * 生成一份逼真的多 SKU 决策示例。
 * 优先用 AI（若已配置）；否则回退到内置真实商品模板。
 * 任何 AI 异常都会被吞掉并回退，保证按钮永远可用。
 */
export async function generateExample(): Promise<GeneratedExample> {
  if (isAiReady()) {
    try {
      const data = await generateViaAi()
      return { ...data, source: 'ai', summary: buildSummary(data.skus, data.config) }
    } catch (e: any) {
      const msg = e?.message ?? String(e)
      console.warn('[aiSample] AI 生成失败，回退内置模板：', e)
      const fb = pickFallback()
      return {
        ...fb,
        source: 'fallback',
        note: `AI 实时生成失败（${msg}），已用内置真实商品示例替代。`,
        summary: buildSummary(fb.skus, fb.config),
      }
    }
  }
  const fb = pickFallback()
  return {
    ...fb,
    source: 'fallback',
    note: '未配置 AI，已加载内置真实商品示例；在右上角「AI 设置」填入 API 后，可生成每次不同的真实示例。',
    summary: buildSummary(fb.skus, fb.config),
  }
}
