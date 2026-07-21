import type { Sku, ParamType } from './types'
import { uid } from './engine'
import { isVisionReady, visionChat } from './ai'

/** AI 识别出的参数维度定义（无 id/weight，导入时再生成） */
export interface RecognizedDim {
  label: string // 维度名，如"电池容量"
  type: ParamType // 'higher-better' | 'lower-better' | 'boolean' | 'text'
  unit?: string // 单位提示，如 "mAh"
  levels?: string[] // text 类型的评级序列
}

/** 识别出的单个规格（带置信度，供 UI 标记可疑项） */
export interface RecognizedSku {
  name: string
  price: number
  quantity: number
  unit: string
  packs: number
  /** 0-1，模型对该条识别的把握；低于阈值时 UI 高亮提示人工核对 */
  confidence: number
  /** 多维参数取值，key = RecognizedDim.label */
  params?: Record<string, string | number>
}

export interface RecognizeResult {
  items: RecognizedSku[]
  /** AI 识别出的商品类型，如 "零食" / "手机" / "洗护" */
  category?: string
  /** AI 识别出的参数维度定义（导入时会合并到 DecisionConfig.dims） */
  dims?: RecognizedDim[]
  /** 数据来源：真实模型 / 演示兜底 / 失败 */
  source: 'api' | 'demo' | 'error'
  /** 模型原始提示（如识别到的总数），便于向用户解释 */
  note?: string
}

/** 置信度低于此值的条目会被 UI 标记为"待核对" */
export const LOW_CONFIDENCE = 0.75

/** 把识别结果转成可入库的 Sku（params key 从 dim.label 映射到 dim.id） */
export function toSku(r: RecognizedSku, labelToId?: Record<string, string>): Sku {
  const sku: Sku = {
    id: uid(),
    name: r.name,
    price: r.price,
    quantity: r.quantity,
    unit: r.unit,
    packs: r.packs,
  }
  if (r.params && labelToId) {
    const params: Record<string, string | number> = {}
    for (const [label, value] of Object.entries(r.params)) {
      const id = labelToId[label]
      if (id) params[id] = value
    }
    if (Object.keys(params).length > 0) sku.params = params
  }
  return sku
}

/**
 * 自适应抽取 prompt：让模型自己判断商品类型，并识别该类型商品的关键参数维度。
 *
 * 返回 JSON 结构（非数组）：
 * {
 *   "category": "零食|手机|洗护|数码|...",
 *   "dims": [{"label":"电池容量","type":"higher-better","unit":"mAh"}, ...],
 *   "items": [{"name":"...","price":...,"quantity":...,"unit":"...","packs":...,"params":{"电池容量":5000},"confidence":0.9}]
 * }
 *
 * 关键：模型自适应，不预设维度。食品可能识别"重量/口味"，数码识别"内存/电池/屏幕"。
 */
export const RECOGNIZE_PROMPT = `你是购物 App 截图的规格抽取器。请识别截图中**所有**商品 SKU 规格，一个都不能漏。

**第一步：判断商品类型**（如 零食、饮料、洗护、数码、手机、电脑、家电、美妆、服饰 等）。

**第二步：根据商品类型，识别该类商品的关键对比参数维度**（2-5 个，用户做购买决策时真正关心的）：
- 食品/零食：可能是 净含量、口味数、热量、蛋白质 等
- 手机/数码：可能是 内存、存储、电池容量、屏幕尺寸、像素 等
- 洗护：可能是 容量、功效、肤质 等
- 不要把"价格""名称"作为参数维度（系统已内置）

每个维度需指定：
- label: 维度名（简洁，如"电池容量"）
- type: 类型，必须是以下之一：
  - "higher-better"（越大越好，如电池容量、内存）
  - "lower-better"（越小越好，如重量、价格）
  - "boolean"（是/否，如"是否含屏幕"）
  - "text"（评级，如能效等级 A/B/C，需提供 levels 数组）
- unit: 单位（如 mAh、GB、英寸），可选
- levels: 仅 type="text" 时提供，按从优到劣排列，如 ["A","B","C"]

**第三步：对每个 SKU，识别基础字段 + 该 SKU 在各维度的取值**：
- name: 规格名称（口味 + 款式，如"香辣味 16g×8袋" 或 "8GB+256GB 黑色"）
- price: 总价数字（元，只保留数字）
- quantity: 单件含量数值（如 16）或 1（数码产品通常为 1）
- unit: 含量单位（g / ml / 个 / GB 等；数码产品用"个"或"件"）
- packs: 件数/袋数（数码产品通常为 1）
- params: 对象，key 用维度 label，value 为该 SKU 在该维度的值（数字或字符串或 "yes"/"no"）
- confidence: 你对这条识别的把握（0-1）

**严格只返回 JSON 对象**，不要任何多余文字、不要 markdown 代码块。

**示例 1（零食）**：
{"category":"零食","dims":[{"label":"净含量","type":"higher-better","unit":"g"},{"label":"袋数","type":"higher-better"}],"items":[{"name":"香辣味 16g×8袋","price":4.94,"quantity":16,"unit":"g","packs":8,"params":{"净含量":16,"袋数":8},"confidence":0.95}]}

**示例 2（手机）**：
{"category":"手机","dims":[{"label":"内存","type":"higher-better","unit":"GB"},{"label":"存储","type":"higher-better","unit":"GB"},{"label":"电池容量","type":"higher-better","unit":"mAh"},{"label":"屏幕尺寸","type":"higher-better","unit":"英寸"}],"items":[{"name":"8GB+256GB 黑色","price":2999,"quantity":1,"unit":"个","packs":1,"params":{"内存":8,"存储":256,"电池容量":5000,"屏幕尺寸":6.7},"confidence":0.92}]}

若某字段看不清，给出最合理估计并把 confidence 降到 0.6 以下。`

/**
 * 调用识别服务。
 * - 若配置了视觉模型（AI 设置），走 visionChat 调真实多模态模型。
 * - 未配置时回退到演示数据，保证纯前端可跑通流程。
 * - 调用失败时显式返回 source='error' + 错误信息，不再静默回退 demo。
 */
export async function recognizeImage(file: File): Promise<RecognizeResult> {
  // 1) 优先走用户在 AI 设置里配的视觉模型（dev 模式自动走 vite 代理）
  if (isVisionReady()) {
    try {
      const base64 = await fileToBase64(file)
      const raw = await visionChat(RECOGNIZE_PROMPT, base64, file.type || 'image/jpeg')
      const parsed = parseResult(raw)
      if (parsed.items.length === 0) {
        return {
          items: [],
          source: 'error',
          note: `模型未识别到任何规格。原始返回：${raw.slice(0, 200)}`,
        }
      }
      return {
        items: parsed.items,
        category: parsed.category,
        dims: parsed.dims,
        source: 'api',
        note: `AI 识别为「${parsed.category ?? '商品'}」· ${parsed.items.length} 个规格 · ${parsed.dims.length} 个参数维度`,
      }
    } catch (err: any) {
      return {
        items: [],
        source: 'error',
        note: err?.message ?? '视觉模型调用失败',
      }
    }
  }

  // 2) 兼容旧的 VITE_RECOGNIZE_ENDPOINT Serverless 端点
  const endpoint = import.meta.env.VITE_RECOGNIZE_ENDPOINT as string | undefined
  if (endpoint) {
    try {
      const base64 = await fileToBase64(file)
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, prompt: RECOGNIZE_PROMPT }),
      })
      if (!resp.ok) throw new Error(`识别服务返回 ${resp.status}`)
      const data = (await resp.json()) as { items: RecognizedSku[]; dims?: RecognizedDim[]; category?: string; note?: string }
      return { items: data.items ?? [], dims: data.dims, category: data.category, source: 'api', note: data.note }
    } catch (err) {
      console.error('识别服务调用失败：', err)
      return {
        items: [],
        source: 'error',
        note: `识别服务异常：${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  // 3) 未配置任何识别能力 → 演示兜底（让用户能体验流程）
  await sleep(1500)
  return demoResult()
}

/** 容错解析：剥离 markdown 代码块，提取 JSON 对象，校验并归一化字段 */
function parseResult(raw: string): { items: RecognizedSku[]; dims: RecognizedDim[]; category?: string } {
  const cleaned = raw.replace(/```json|```/g, '').trim()
  // 优先匹配对象 { ... }
  const objMatch = cleaned.match(/\{[\s\S]*\}/)
  if (!objMatch) return { items: [], dims: [] }
  try {
    const obj = JSON.parse(objMatch[0])
    const category = typeof obj?.category === 'string' ? obj.category : undefined
    const dims = parseDims(obj?.dims)
    const items = parseItems(obj?.items, dims)
    return { items, dims, category }
  } catch {
    return { items: [], dims: [] }
  }
}

function parseDims(raw: any): RecognizedDim[] {
  if (!Array.isArray(raw)) return []
  const validTypes: ParamType[] = ['higher-better', 'lower-better', 'boolean', 'text']
  return raw
    .map((d: any): RecognizedDim | null => {
      const label = String(d?.label ?? '').trim()
      if (!label) return null
      const type = validTypes.includes(d?.type) ? d.type : 'higher-better'
      const dim: RecognizedDim = { label, type }
      if (d?.unit) dim.unit = String(d.unit)
      if (type === 'text' && Array.isArray(d?.levels) && d.levels.length > 0) {
        dim.levels = d.levels.map((l: any) => String(l)).filter(Boolean)
      }
      return dim
    })
    .filter((d: RecognizedDim | null): d is RecognizedDim => d !== null)
}

function parseItems(raw: any, dims: RecognizedDim[]): RecognizedSku[] {
  if (!Array.isArray(raw)) return []
  const knownLabels = new Set(dims.map((d) => d.label))
  return raw
    .map((it: any): RecognizedSku | null => {
      const name = String(it?.name ?? '').trim()
      if (!name) return null
      const price = Number(it?.price) || 0
      if (price <= 0) return null
      const sku: RecognizedSku = {
        name,
        price,
        quantity: Number(it?.quantity) || 1,
        unit: String(it?.unit ?? '个'),
        packs: Math.max(1, parseInt(it?.packs) || 1),
        confidence: typeof it?.confidence === 'number' ? it.confidence : 0.8,
      }
      // 只保留已知维度的 params，过滤掉模型瞎编的字段
      if (it?.params && typeof it.params === 'object') {
        const params: Record<string, string | number> = {}
        for (const [k, v] of Object.entries(it.params)) {
          if (knownLabels.has(k)) {
            params[k] = typeof v === 'number' ? v : String(v)
          }
        }
        if (Object.keys(params).length > 0) sku.params = params
      }
      return sku
    })
    .filter((it: RecognizedSku | null): it is RecognizedSku => it !== null)
}

/** 演示兜底：模拟手机场景识别，带 3 个参数维度，让用户能体验多维参数流程 */
function demoResult(note?: string): RecognizeResult {
  const dims: RecognizedDim[] = [
    { label: '内存', type: 'higher-better', unit: 'GB' },
    { label: '存储', type: 'higher-better', unit: 'GB' },
    { label: '电池容量', type: 'higher-better', unit: 'mAh' },
  ]
  const items: RecognizedSku[] = [
    { name: '8GB+128GB 黑色', price: 2999, quantity: 1, unit: '个', packs: 1, confidence: 0.92, params: { '内存': 8, '存储': 128, '电池容量': 4500 } },
    { name: '8GB+256GB 黑色', price: 3299, quantity: 1, unit: '个', packs: 1, confidence: 0.9, params: { '内存': 8, '存储': 256, '电池容量': 4500 } },
    { name: '12GB+256GB 黑色', price: 3699, quantity: 1, unit: '个', packs: 1, confidence: 0.88, params: { '内存': 12, '存储': 256, '电池容量': 5000 } },
    { name: '12GB+512GB 蓝色', price: 3999, quantity: 1, unit: '个', packs: 1, confidence: 0.58, params: { '内存': 12, '存储': 512, '电池容量': 5000 } },
  ]
  return {
    items,
    category: '手机',
    dims,
    source: 'demo',
    note: note ?? '演示模式（未配置视觉模型）：示例 4 款手机规格 · 3 个参数维度。到「AI 设置」配一个视觉模型即可真实识别。',
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result)
      resolve(result.includes(',') ? result.split(',')[1] : result)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
