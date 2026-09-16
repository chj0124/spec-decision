// Vercel Serverless Function：AI 截图识别转发端点
// 前端把 base64 图片 + Prompt POST 到这里，本函数携带密钥调用多模态大模型，
// 返回结构化 JSON 数组。密钥通过环境变量配置，绝不暴露给浏览器。
//
// ── 安全契约（A2 · 风险卡 R1）────────────────────────────────────────────────
//   这是「无鉴权 + 烧我方付费 key」的高危端点，因此默认关闭，必须显式开启：
//     RECOGNIZE_TOKEN         必填。未配置时端点一律 503（等同下线）。
//     RECOGNIZE_ALLOWED_ORIGINS  可选，逗号分隔。配置后强制校验来源域名（防盗链）。
//     RECOGNIZE_PROVIDER      可选，qwen | openai，默认 qwen。
//   请求需携带 `Authorization: Bearer <token>` 或 `x-recognize-token: <token>`。
//   另叠加：内存限流（best-effort，见 checkRateLimit 注释）+ 体积/长度上限 + 上游超时。
//
// 部署后前端把 VITE_RECOGNIZE_ENDPOINT 设为 /api/recognize 即可（需同时配置带鉴权的反代，
// 否则公开的前端无法安全携带令牌——推荐直接用「AI 设置」里的自带密钥视觉模型）。

export const config = { runtime: 'edge' }

/** 请求体字节上限（base64 图片在 JSON 里会被显著放大） */
export const MAX_BODY_BYTES = 6 * 1024 * 1024
/** base64 图片字符串长度上限（约为 4.5MB 原始图） */
export const MAX_IMAGE_CHARS = 6 * 1024 * 1024
/** prompt 字符数上限 */
export const MAX_PROMPT_CHARS = 8000
/** 单实例内存限流：每窗口最大请求数与窗口长度 */
export const RATE_LIMIT_MAX = 10
export const RATE_LIMIT_WINDOW_MS = 60_000
/** 上游模型调用超时 */
const UPSTREAM_TIMEOUT_MS = 30_000

interface IncomingItem {
  name: string
  price: number
  quantity: number
  unit: string
  packs: number
  confidence: number
}

/** 带 HTTP 状态码的错误，便于 handler 统一映射响应 */
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

/** 限流桶：模块级 Map，随函数实例存活。注意：Serverless 多实例下各自计数，
 *  仅作「防误用/轻度滥用」的 best-effort 护栏，不构成严格配额；严格配额需外部存储。 */
const buckets = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(key: string, now = Date.now()): boolean {
  const b = buckets.get(key)
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }
  if (b.count >= RATE_LIMIT_MAX) return false
  b.count += 1
  return true
}

/** 定长比较，避免令牌比较的时序侧信道 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function readEnv(name: string): string | undefined {
  try {
    return process.env[name]
  } catch {
    return undefined
  }
}

/** 从请求头取鉴权令牌（Bearer 或 x-recognize-token） */
export function extractToken(req: Request): string {
  const auth = req.headers.get('authorization') ?? ''
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  return bearer || (req.headers.get('x-recognize-token') ?? '').trim()
}

/** 来源域名白名单：未配置时不限制；配置后 Origin/Referer 主机必须命中 */
export function isOriginAllowed(req: Request, allowed: string[]): boolean {
  if (allowed.length === 0) return true
  const raw = req.headers.get('origin') ?? req.headers.get('referer') ?? ''
  if (!raw) return false
  let host: string
  try {
    host = new URL(raw).hostname.toLowerCase()
  } catch {
    return false
  }
  return allowed.some((h) => {
    const allow = h.trim().toLowerCase()
    return allow === host || (allow.startsWith('*.') && host.endsWith(allow.slice(1)))
  })
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'Method Not Allowed' }, 405)
  }

  // 1) 默认关闭：未配置令牌即视为未启用/已下线
  const token = readEnv('RECOGNIZE_TOKEN')?.trim()
  if (!token) {
    return json({ error: '识别端点未启用（需配置 RECOGNIZE_TOKEN）' }, 503)
  }

  // 2) 来源域名白名单（可选，防盗链）
  const allowedOrigins = (readEnv('RECOGNIZE_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!isOriginAllowed(req, allowedOrigins)) {
    return json({ error: '来源不被允许' }, 403)
  }

  // 3) 鉴权
  if (!safeEqual(extractToken(req), token)) {
    return json({ error: '未鉴权' }, 401)
  }

  // 4) 限流
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
  if (!checkRateLimit(`${ip}:${token.slice(0, 8)}`)) {
    return json({ error: '请求过于频繁，请稍后再试' }, 429)
  }

  // 5) 体积预检（Content-Length 可信时直接拒绝，避免读入超大 body）
  const declared = Number(req.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return json({ error: '请求体过大' }, 413)
  }

  let body: { image?: string; prompt?: string }
  try {
    body = (await req.json()) as { image?: string; prompt?: string }
  } catch {
    return json({ error: '请求体不是合法 JSON' }, 400)
  }

  const image = body.image
  if (!image || typeof image !== 'string') return json({ error: '缺少 image 字段' }, 400)
  // 6) 读入后再校验一次（Content-Length 缺失/伪造时的兜底）
  if (image.length > MAX_IMAGE_CHARS) return json({ error: '图片过大' }, 413)

  const prompt = typeof body.prompt === 'string' ? body.prompt : ''
  if (prompt.length > MAX_PROMPT_CHARS) return json({ error: 'prompt 过长' }, 400)

  const provider = (readEnv('RECOGNIZE_PROVIDER') ?? 'qwen').trim()
  if (provider !== 'qwen' && provider !== 'openai') {
    // 未实现的 provider 明确返回 501，而不是抛裸错
    return json({ error: `未实现的 provider: ${provider}` }, 501)
  }

  // 7) 上游调用包 try/catch，异常一律 502，且不回传密钥相关细节
  let raw: string
  try {
    raw = await callModel(provider, prompt, image)
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 502
    const message = e instanceof Error ? e.message : '上游调用失败'
    return json({ error: message }, status)
  }

  const items = parseItems(raw)
  return json({ items, note: `模型(${provider})识别到 ${items.length} 个规格` })
}

/** 调用多模态模型，返回模型输出的纯文本（应为 JSON 数组字符串） */
async function callModel(provider: string, prompt: string, imageBase64: string): Promise<string> {
  if (provider === 'qwen') {
    const resp = await fetch(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${readEnv('DASHSCOPE_API_KEY')}`,
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
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      },
    )
    if (!resp.ok) throw new HttpError(502, `上游返回 ${resp.status}`)
    const data = (await resp.json()) as any
    return data?.output?.choices?.[0]?.message?.content?.[0]?.text ?? '[]'
  }

  // openai
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${readEnv('OPENAI_API_KEY')}`,
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
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  })
  if (!resp.ok) throw new HttpError(502, `上游返回 ${resp.status}`)
  const data = (await resp.json()) as any
  return data?.choices?.[0]?.message?.content ?? '[]'
}

/** 容错解析：剥离 markdown 代码块，提取 JSON 数组，校验并归一化字段。导出以便单测。 */
export function parseItems(raw: string): IncomingItem[] {
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
