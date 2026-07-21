import type { Sku } from './types'
import { uid } from './engine'

/** 识别出的单个规格（带置信度，供 UI 标记可疑项） */
export interface RecognizedSku {
  name: string
  price: number
  quantity: number
  unit: string
  packs: number
  /** 0-1，模型对该条识别的把握；低于阈值时 UI 高亮提示人工核对 */
  confidence: number
}

export interface RecognizeResult {
  items: RecognizedSku[]
  /** 数据来源：真实模型 / 演示兜底 */
  source: 'api' | 'demo'
  /** 模型原始提示（如识别到的总数），便于向用户解释 */
  note?: string
}

/** 置信度低于此值的条目会被 UI 标记为"待核对" */
export const LOW_CONFIDENCE = 0.75

/** 把识别结果转成可入库的 Sku */
export function toSku(r: RecognizedSku): Sku {
  return {
    id: uid(),
    name: r.name,
    price: r.price,
    quantity: r.quantity,
    unit: r.unit,
    packs: r.packs,
  }
}

/** 抽取系统提示词：强约束，要求穷尽所有 SKU 并返回结构化 JSON */
export const RECOGNIZE_PROMPT = `你是购物 App 截图的规格抽取器。请识别截图中**所有**商品 SKU 规格，包括每个"口味 × 款式/容量"的组合，一个都不能漏。

对每一个规格，输出：
- name: 规格名称（口味 + 款式，如"香辣味 16g×8袋"）
- price: 总价数字（元，只保留数字）
- quantity: 单件含量数值（如 16）
- unit: 含量单位（g / ml / 个 / GB 等）
- packs: 件数/袋数（如 8）
- confidence: 你对这条识别的把握（0-1）

严格只返回 JSON 数组，不要任何多余文字、不要 markdown 代码块。
示例：[{"name":"香辣味 16g×8袋","price":4.94,"quantity":16,"unit":"g","packs":8,"confidence":0.95}]

若某字段看不清，给出最合理估计并把 confidence 降到 0.6 以下。`

/**
 * 调用识别服务。
 * 生产路径：POST 到 Serverless 转发端点（密钥在服务端），返回结构化结果。
 * 未配置端点时：回退到演示数据，保证纯前端可跑通流程。
 */
export async function recognizeImage(file: File): Promise<RecognizeResult> {
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
      const data = (await resp.json()) as { items: RecognizedSku[]; note?: string }
      return { items: data.items ?? [], source: 'api', note: data.note }
    } catch (err) {
      console.error('识别服务调用失败，回退演示数据：', err)
      return demoResult('识别服务异常，已用演示数据兜底')
    }
  }

  // 未配置真实端点 → 演示兜底（模拟 3口味×4款式 的全量识别）
  await sleep(1500)
  return demoResult()
}

/** 演示兜底：模拟"3 口味 × 4 款式"共 12 个 SKU 的全量识别，含个别低置信度项 */
function demoResult(note?: string): RecognizeResult {
  const flavors = ['香辣味', '原味', '烧烤味']
  const styles: Array<{ label: string; q: number; packs: number; price: number }> = [
    { label: '16g×8袋', q: 16, packs: 8, price: 4.94 },
    { label: '16g×16袋', q: 16, packs: 16, price: 8.9 },
    { label: '20g×10袋', q: 20, packs: 10, price: 7.5 },
    { label: '30g×20袋', q: 30, packs: 20, price: 16.8 },
  ]
  const items: RecognizedSku[] = []
  for (const f of flavors) {
    for (const s of styles) {
      // 故意让一两条置信度偏低，演示"待核对"高亮
      const low = f === '烧烤味' && s.packs === 16
      items.push({
        name: `${f} ${s.label}`,
        price: s.price,
        quantity: s.q,
        unit: 'g',
        packs: s.packs,
        confidence: low ? 0.58 : 0.9 + Math.random() * 0.08,
      })
    }
  }
  return {
    items,
    source: 'demo',
    note: note ?? '演示模式：识别到 3 口味 × 4 款式共 12 个规格',
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
