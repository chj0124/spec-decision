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
  /** 批量识别时标记来自哪张图（索引），用于 review 面板显示来源角标 */
  sourceImage?: number
}

export interface RecognizeResult {
  items: RecognizedSku[]
  /** AI 识别出的商品类型，如 "零食" / "手机" / "洗护" */
  category?: string
  /** AI 建议的"口味列"列名，如 "口味" / "型号" / "颜色" / "款式" */
  flavorLabel?: string
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
 * 关键设计：
 * - 维度必须是"用户购买该类商品时真正用于对比性价比"的可量化参数
 * - 口味/颜色/款式等主观偏好不作为维度（它们只影响名称，不影响性价比）
 * - 若商品没有可量化的对比参数（如螺丝），dims 返回空数组 []
 *
 * 返回 JSON 结构：
 * {
 *   "category": "零食|手机|五金|...",
 *   "dims": [{"label":"电池容量","type":"higher-better","unit":"mAh"}, ...],
 *   "items": [{"name":"...","price":...,"quantity":...,"unit":"...","packs":...,"params":{"电池容量":5000},"confidence":0.9}]
 * }
 */
export const RECOGNIZE_PROMPT = `识别截图里所有商品 SKU 规格。直接输出 JSON，不要任何解释、推理或 markdown。

输出格式：
{"category":"商品类型","flavorLabel":"列名","dims":[参数维度],"items":[规格列表]}

字段说明：
- category: 商品类型（如"零食"/"手机"/"五金螺丝"/"纸巾"）
- flavorLabel: SKU 名称里第一个词的分类名。看截图里 SKU 名称的结构判断：
  · 食品/零食/饮料 → "口味"（如"香辣味 16g×8袋" → 口味）
  · 五金/螺丝/工具 → "型号"（如"M4×10mm 不锈钢" → 型号）
  · 手机/数码/电子 → "颜色"或"版本"（如"8GB+256GB 黑色" → 颜色）
  · 服装/鞋帽 → "款式"
  · 洗护/美妆 → "香型"
  · 纸巾/日用 → "规格"（若无独立的首词分类，填"规格"）
  · 其他 → 根据该类商品的习惯叫法判断

参数维度 dims（0-5个，仅包含用户购买该类商品时真正用于对比性价比的可量化参数；没有可量化参数时返回空数组 []）：
- 必须是可量化或可评级的参数（如重量、容量、内存、电池容量、直径、长度、材质强度）
- 禁止把口味/颜色/款式/香型等主观偏好作为维度（它们只影响名称，不影响性价比）
- 禁止把价格/名称/品牌作为维度
- label: 维度名
- type: "higher-better"|"lower-better"|"boolean"|"text"
- unit: 单位（可选）
- levels: 仅 text 类型需要，按从优到劣排列

规格列表 items（每个 SKU）：
- name: 规格名称（含口味/颜色等偏好属性，如"香辣味 16g×8袋"）
- price: 总价（元，纯数字）
- quantity: 单件含量数值（数码/五金等计件商品填1）
- unit: 单位（g/ml/个/GB/mm等）
- packs: 件数（计件商品填1）
- params: 对象，key=维度label，value=该SKU在该维度的值；无维度时省略或空对象
- confidence: 把握 0-1

示例（手机）：
{"category":"手机","flavorLabel":"颜色","dims":[{"label":"内存","type":"higher-better","unit":"GB"},{"label":"电池容量","type":"higher-better","unit":"mAh"}],"items":[{"name":"8GB+256GB 黑色","price":2999,"quantity":1,"unit":"个","packs":1,"params":{"内存":8,"电池容量":5000},"confidence":0.9}]}

示例（零食，口味进名称不进维度）：
{"category":"零食","flavorLabel":"口味","dims":[{"label":"净含量","type":"higher-better","unit":"g"}],"items":[{"name":"香辣味 16g×8袋","price":4.94,"quantity":16,"unit":"g","packs":8,"params":{"净含量":16},"confidence":0.95}]}

示例（螺丝，无可量化对比参数，dims 为空）：
{"category":"五金螺丝","flavorLabel":"型号","dims":[],"items":[{"name":"M4×10mm 不锈钢内六角","price":9.9,"quantity":1,"unit":"个","packs":100,"confidence":0.85}]}

示例（纸巾）：
{"category":"纸巾","flavorLabel":"规格","dims":[],"items":[{"name":"3层120抽 抽纸","price":15.9,"quantity":120,"unit":"抽","packs":3,"confidence":0.9}]}

只输出 JSON，不要其他文字。`

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
      const { base64, mime } = await compressImage(file)
      const raw = await visionChat(RECOGNIZE_PROMPT, base64, mime)
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
        flavorLabel: parsed.flavorLabel,
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
      const { base64, mime } = await compressImage(file)
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, mime, prompt: RECOGNIZE_PROMPT }),
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

/**
 * 批量识别多张图片：并发识别每张图，按规格名合并去重，标记来源图片索引。
 *
 * 设计要点：
 * - 并发识别所有图片（Promise.allSettled），单张失败不影响其他
 * - 相同 name 的 SKU 自动去重：保留后出现的（后识别的覆盖前者，因用户通常按顺序截更详细的图）
 * - dims 按 label 去重合并：同一 label 只保留第一次出现的定义
 * - category / flavorLabel 以第一张成功识别的结果为准
 * - 每条 SKU 标记 sourceImage（图片索引），review 面板显示来源角标
 */
export async function recognizeImages(files: File[]): Promise<RecognizeResult> {
  if (files.length === 1) {
    // 单图直接走原逻辑，不附加 sourceImage
    return recognizeImage(files[0])
  }

  const settled = await Promise.allSettled(files.map((f) => recognizeImage(f)))

  let mergedItems: RecognizedSku[] = []
  let mergedDims: RecognizedDim[] = []
  let category: string | undefined
  let flavorLabel: string | undefined
  const notes: string[] = []
  let failCount = 0
  let hasApi = false

  for (let i = 0; i < settled.length; i++) {
    const r = settled[i]
    if (r.status === 'rejected' || r.value.source === 'error') {
      failCount++
      const reason = r.status === 'rejected'
        ? String(r.reason)
        : r.value.note ?? '识别失败'
      notes.push(`图${i + 1}：${reason}`)
      continue
    }
    const res = r.value
    if (!category) category = res.category
    if (!flavorLabel) flavorLabel = res.flavorLabel
    if (res.source === 'api') hasApi = true
    if (res.note) notes.push(`图${i + 1}：${res.note}`)

    // 合并 items：标记来源图，按 name 去重（后者覆盖前者）
    for (const it of res.items) {
      const tagged = { ...it, sourceImage: i }
      const existIdx = mergedItems.findIndex((m) => m.name.trim() === it.name.trim())
      if (existIdx >= 0) {
        mergedItems[existIdx] = tagged
      } else {
        mergedItems.push(tagged)
      }
    }

    // 合并 dims：按 label 去重
    for (const d of res.dims ?? []) {
      if (!mergedDims.some((m) => m.label === d.label)) {
        mergedDims.push(d)
      }
    }
  }

  // 全部失败
  if (mergedItems.length === 0) {
    return {
      items: [],
      source: 'error',
      note: `全部 ${files.length} 张图识别失败。${notes.join('；')}`,
    }
  }

  const successCount = files.length - failCount
  return {
    items: mergedItems,
    dims: mergedDims,
    category,
    flavorLabel,
    source: hasApi ? 'api' : 'demo',
    note: `批量识别 ${successCount}/${files.length} 张图成功 · 合并去重后 ${mergedItems.length} 个规格${failCount > 0 ? ` · ${failCount} 张失败` : ''}`,
  }
}

/** 容错解析：剥离 markdown 代码块，提取 JSON 对象，校验并归一化字段 */
function parseResult(raw: string): { items: RecognizedSku[]; dims: RecognizedDim[]; category?: string; flavorLabel?: string } {
  const cleaned = raw.replace(/```json|```/g, '').trim()
  // 优先匹配对象 { ... }
  const objMatch = cleaned.match(/\{[\s\S]*\}/)
  if (!objMatch) return { items: [], dims: [] }
  try {
    const obj = JSON.parse(objMatch[0])
    const category = typeof obj?.category === 'string' ? obj.category : undefined
    const flavorLabel = typeof obj?.flavorLabel === 'string' ? obj.flavorLabel : undefined
    const dims = parseDims(obj?.dims)
    const items = parseItems(obj?.items, dims)
    return { items, dims, category, flavorLabel }
  } catch {
    return { items: [], dims: [] }
  }
}

/**
 * 应被过滤的主观偏好词（口味/颜色/款式/香型等）。
 * 这些是购买时的个人偏好，不影响性价比对比，不作为参数维度。
 * AI 即使返回了也强制剔除。
 */
const SUBJECTIVE_KEYWORDS = [
  '口味', '味道', '风味', '香型', '香味',
  '颜色', '色彩', '配色',
  '款式', '样式', '造型',
  '图案', '花色', '花纹',
  '品牌', '型号',
]

function isSubjectiveDim(label: string): boolean {
  const s = label.trim()
  return SUBJECTIVE_KEYWORDS.some((kw) => s === kw || s.includes(kw))
}

function parseDims(raw: any): RecognizedDim[] {
  if (!Array.isArray(raw)) return []
  const validTypes: ParamType[] = ['higher-better', 'lower-better', 'boolean', 'text']
  return raw
    .map((d: any): RecognizedDim | null => {
      const label = String(d?.label ?? '').trim()
      if (!label) return null
      // 强制过滤主观偏好维度（AI 可能仍会返回口味/颜色等）
      if (isSubjectiveDim(label)) return null
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
    flavorLabel: '颜色',
    dims,
    source: 'demo',
    note: note ?? '演示模式（未配置视觉模型）：示例 4 款手机规格 · 3 个参数维度。到「AI 设置」配一个视觉模型即可真实识别。',
  }
}

/**
 * 压缩图片：缩放到 max 1280px + JPEG quality 85。
 * 用户截图通常 1-5MB（高分辨率 PNG），压缩到 100-300KB，
 * 大幅减小请求 body + 加快模型处理。
 */
async function compressImage(file: File, maxDim = 1280, quality = 0.85): Promise<{ base64: string; mime: string }> {
  // 如果已经是小图（< 300KB），直接转 base64 不压缩
  if (file.size < 300 * 1024) {
    const base64 = await fileToBase64(file)
    return { base64, mime: file.type || 'image/jpeg' }
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        // 等比缩放，长边不超过 maxDim
        let { width, height } = img
        if (width > maxDim || height > maxDim) {
          if (width >= height) {
            height = Math.round((height / width) * maxDim)
            width = maxDim
          } else {
            width = Math.round((width / height) * maxDim)
            height = maxDim
          }
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('canvas 不可用'))
          return
        }
        ctx.drawImage(img, 0, 0, width, height)
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('压缩失败'))
              return
            }
            const reader2 = new FileReader()
            reader2.onload = () => {
              const result = String(reader2.result)
              const base64 = result.includes(',') ? result.split(',')[1] : result
              resolve({ base64, mime: 'image/jpeg' })
            }
            reader2.onerror = reject
            reader2.readAsDataURL(blob)
          },
          'image/jpeg',
          quality,
        )
      }
      img.onerror = () => reject(new Error('图片加载失败'))
      img.src = String(reader.result)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
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
