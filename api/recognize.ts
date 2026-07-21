// Vercel Serverless Function：AI 截图识别转发端点
// 前端把 base64 图片 + Prompt POST 到这里，本函数携带密钥调用多模态大模型，
// 返回结构化 JSON 数组。密钥通过环境变量配置，绝不暴露给浏览器。
//
// 部署后前端把 VITE_RECOGNIZE_ENDPOINT 设为 /api/recognize 即可。
//
// 支持的模型（任选其一，用环境变量切换）：
//   - 通义千问 Qwen-VL（DashScope，国内中文购物截图识别效果好，推荐）
//   - 智谱 GLM-4V
//   - OpenAI GPT-4o
//   - Google Gemini Flash

export const config = { runtime: 'edge' }

const PROVIDER = process.env.RECOGNIZE_PROVIDER ?? 'qwen' // qwen | glm | openai | gemini

interface IncomingItem {
  name: string
  price: number
  quantity: number
  unit: string
  packs: number
  confidence: number
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'Method Not Allowed' }, 405)
  }

  let body: { image?: string; prompt?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: '请求体不是合法 JSON' }, 400)
  }
  if (!body.image) return json({ error: '缺少 image 字段' }, 400)

  const prompt = body.prompt ?? ''
  const raw = await callModel(prompt, body.image)
  const items = parseItems(raw)

  return json({ items, note: `模型(${PROVIDER})识别到 ${items.length} 个规格` })
}

/** 调用多模态模型，返回模型输出的纯文本（应为 JSON 数组字符串） */
async function callModel(prompt: string, imageBase64: string): Promise<string> {
  if (PROVIDER === 'qwen') {
    const resp = await fetch(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'qwen-vl-max',
          input: {
            messages: [
              {
                role: 'user',
                content: [
                  { image: `data:image/jpeg;base64,${imageBase64}` },
                  { text: prompt },
                ],
              },
            ],
          },
        }),
      },
    )
    const data = await resp.json()
    return data?.output?.choices?.[0]?.message?.content?.[0]?.text ?? '[]'
  }

  if (PROVIDER === 'openai') {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
            ],
          },
        ],
        response_format: { type: 'json_object' },
      }),
    })
    const data = await resp.json()
    return data?.choices?.[0]?.message?.content ?? '[]'
  }

  // 其他 provider 可按同样模式扩展（GLM-4V / Gemini）
  throw new Error(`未实现的 provider: ${PROVIDER}`)
}

/** 容错解析：剥离 markdown 代码块，提取 JSON 数组，校验并归一化字段 */
function parseItems(raw: string): IncomingItem[] {
  const cleaned = raw.replace(/```json|```/g, '').trim()
  const match = cleaned.match(/\[[\s\S]*\]/)
  if (!match) return []
  try {
    const arr = JSON.parse(match[0])
    if (!Array.isArray(arr)) return []
    return arr
      .map((it: any) => ({
        name: String(it?.name ?? '').trim(),
        price: Number(it?.price) || 0,
        quantity: Number(it?.quantity) || 0,
        unit: String(it?.unit ?? 'g'),
        packs: Math.max(1, parseInt(it?.packs) || 1),
        confidence: typeof it?.confidence === 'number' ? it.confidence : 0.8,
      }))
      .filter((it) => it.name && it.price > 0)
  } catch {
    return []
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
