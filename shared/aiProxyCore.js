// AI 代理共享核心。
//
// 同一个 OpenAI 兼容代理契约需要在三处落地：
//   1) 本地开发：vite.config.ts 的 dev middleware
//   2) Vercel：api/ai-chat.js、api/ai-models.js
//   3) Cloudflare：根目录 _worker.js
// 之前这三处各写了一份「校验 + 转发」，规则容易改一处漏两处。
// 现在校验与转发只此一份，各平台只保留极薄的适配层（读请求体、写响应、加 CORS）。
//
// 只依赖标准 fetch / JSON / String / URL / AbortSignal，所以 Node（vite / Vercel）
// 与 Workers 运行时都能直接执行。
//
// ── 安全契约（三处入口共用，改动需同步三端验收）────────────────────────────
//   1) 目标主机必须命中白名单，否则 403：客户端不能再把这个代理当作「任意主机转发器」。
//   2) 只允许 https，禁止 URL 内嵌凭据与显式端口；私网 / 环回 / 链路本地 / 保留段，
//      以及无点的内部主机名一律 400。这是 SSRF 的主防线。
//   3) 请求体有字节上限、上游请求有超时，避免被当作内存与出口带宽的放大器。
//   4) 白名单本身即 DNS rebinding 的缓解：攻击者无法控制 api.deepseek.com 这类已知
//      服务商的解析结果，因此不做解析后的二次 IP 校验（Workers 运行时也没有该能力）。

const DEFAULT_TEMPERATURE = 0.1
const UPSTREAM_ERROR = '上游请求失败'

/** 请求体字节上限（含视觉请求的 base64 图片） */
export const MAX_BODY_BYTES = 8 * 1024 * 1024
/** 上游请求超时（毫秒） */
export const UPSTREAM_TIMEOUT_MS = 30_000

/**
 * 允许代理的目标主机。只列已知的 OpenAI 兼容服务商。
 * 部署方可用环境变量 AI_PROXY_ALLOWED_HOSTS（逗号分隔）追加自建网关；
 * Cloudflare Worker 无 process.env，可在 fetch 里用 env.AI_PROXY_ALLOWED_HOSTS 传入。
 */
const DEFAULT_ALLOWED_HOSTS = [
  'api.deepseek.com',
  'dashscope.aliyuncs.com',
  'open.bigmodel.cn',
  'api.openai.com',
]

function readEnv(name) {
  try {
    if (typeof process !== 'undefined' && process && process.env) return process.env[name]
  } catch {
    // Cloudflare Workers 没有 process，忽略即可，回落到内置白名单
  }
  return undefined
}

function resolveAllowedHosts(extra) {
  const list = []
  if (Array.isArray(extra)) list.push(...extra)
  else if (typeof extra === 'string') list.push(...extra.split(','))
  list.push(...String(readEnv('AI_PROXY_ALLOWED_HOSTS') ?? '').split(','))
  return new Set(
    [...DEFAULT_ALLOWED_HOSTS, ...list]
      .map((s) => String(s).trim().toLowerCase())
      .filter(Boolean),
  )
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/** IPv4 是否属于私网 / 环回 / 链路本地 / 保留段 */
function isRestrictedIpv4(ip) {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4) return true
  if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127 || a >= 224) return true // 本网/私网/环回/组播与保留
  if (a === 100 && b >= 64 && b <= 127) return true // 运营商级 NAT
  if (a === 169 && b === 254) return true // 链路本地，含云元数据 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 192 && b === 0) return true // 含 192.0.0.0/24 与测试段
  if (a === 198 && (b === 18 || b === 19)) return true // 基准测试段
  return false
}

/** 主机名是否指向受限地址（SSRF 主防线） */
function isRestrictedAddress(rawHostname) {
  const host = String(rawHostname).replace(/^\[|\]$/g, '').toLowerCase()

  // IPv4-mapped IPv6，如 ::ffff:169.254.169.254（new URL 常归一化为 ::ffff:a9fe:a9fe）
  const mappedDotted = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (mappedDotted) return isRestrictedIpv4(mappedDotted[1])
  const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16)
    const lo = parseInt(mappedHex[2], 16)
    return isRestrictedIpv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`)
  }

  // IPv4 字面量
  if (IPV4_RE.test(host)) return isRestrictedIpv4(host)

  // IPv6 字面量
  if (host.includes(':')) {
    if (host === '::' || host === '::1') return true
    if (/^f[cd]/.test(host)) return true // fc00::/7 唯一本地地址
    if (/^fe[89ab]/.test(host)) return true // fe80::/10 链路本地
    if (/^ff/.test(host)) return true // ff00::/8 组播
    return false
  }

  // 非 IP 主机名：无点的是内部主机名（localhost / metadata 之类）
  if (!host.includes('.')) return true
  if (/(^|\.)(local|internal|localhost|lan|intranet|home\.arpa)$/.test(host)) return true
  return false
}

/**
 * 校验客户端给的 baseUrl。
 * @returns {{ error: string, status: number } | { base: string }}
 */
export function validateBaseUrl(rawBaseUrl, options = {}) {
  const raw = String(rawBaseUrl ?? '').trim()
  if (!raw) return { error: '缺少 baseUrl', status: 400 }

  let url
  try {
    url = new URL(raw)
  } catch {
    return { error: 'baseUrl 不是合法 URL', status: 400 }
  }

  if (url.username || url.password) return { error: 'baseUrl 不允许内嵌凭据', status: 400 }
  if (url.protocol !== 'https:') return { error: 'baseUrl 仅支持 https', status: 400 }
  if (url.port) return { error: 'baseUrl 不允许指定端口', status: 400 }

  const hostname = url.hostname.replace(/\.$/, '').toLowerCase()
  if (isRestrictedAddress(hostname)) {
    return { error: 'baseUrl 指向受限地址', status: 400 }
  }

  const allowed = resolveAllowedHosts(options.allowedHosts)
  const hit =
    allowed.has(hostname) ||
    [...allowed].some((h) => h.startsWith('*.') && hostname.endsWith(h.slice(1)))
  if (!hit) {
    return { error: `baseUrl 主机未在允许列表中：${hostname}`, status: 403 }
  }

  // 只用 protocol + host + path 重新拼装，丢弃 query / hash，避免参数注入
  const path = url.pathname.replace(/\/+$/, '')
  return { base: `${url.protocol}//${url.host}${path}` }
}

function json(status, payload) {
  return { status, text: JSON.stringify(payload) }
}

/**
 * Content-Length 是否超过上限。缺失或非法时返回 false，交给读取层边读边计数兜底。
 */
export function isPayloadTooLarge(contentLength) {
  const n = Number(contentLength)
  return Number.isFinite(n) && n > MAX_BODY_BYTES
}

const utf8 = new TextEncoder()

/** 字符串的 UTF-8 字节数（Node 与 Workers 运行时通用） */
export function utf8ByteLength(text) {
  return utf8.encode(String(text ?? '')).length
}

/**
 * 已读入正文是否超过字节上限。
 * 用于 Content-Length 缺失或被伪造时的兜底——必须在 JSON.parse 之前判定，
 * 否则超大 body 已经占用了函数内存。
 */
export function isTextTooLarge(text) {
  return utf8ByteLength(text) > MAX_BODY_BYTES
}

/**
 * 由请求体构造 chat/completions 的上游请求。
 * 多余的字段（如豆包的 thinking）原样透传。
 * @returns {{ error: string, status: number } | { targetUrl: string, init: object }}
 */
export function buildChatRequest(body, options = {}) {
  const { baseUrl, apiKey, model, messages, temperature, ...extra } = body || {}
  if (!baseUrl || !apiKey || !model) return { error: '缺少 baseUrl/apiKey/model', status: 400 }

  const target = validateBaseUrl(baseUrl, options)
  if (target.error) return target

  return {
    targetUrl: `${target.base}/chat/completions`,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: typeof temperature === 'number' ? temperature : DEFAULT_TEMPERATURE,
        ...extra,
      }),
    },
  }
}

/**
 * 由请求体构造 GET /models 的上游请求。
 * @returns {{ error: string, status: number } | { targetUrl: string, init: object }}
 */
export function buildModelsRequest(body, options = {}) {
  const { baseUrl, apiKey } = body || {}
  if (!baseUrl || !apiKey) return { error: '缺少 baseUrl/apiKey', status: 400 }

  const target = validateBaseUrl(baseUrl, options)
  if (target.error) return target

  return {
    targetUrl: `${target.base}/models`,
    init: { headers: { Authorization: `Bearer ${apiKey}` } },
  }
}

// 执行转发：不抛错，把上游状态码与正文原样回传，交由适配层决定怎么写响应。
// 超时用 AbortController + setTimeout 手写（而非 AbortSignal.timeout）：语义等价，
// 但可被 fake timer 单测驱动，且 Node / Workers 运行时都稳定支持。
// options.timeoutMs 仅供测试或特定调用方覆盖默认超时。
async function forward(built, options = {}) {
  if (built.error) return json(built.status ?? 400, { error: built.error })

  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : UPSTREAM_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const upstream = await fetch(built.targetUrl, { ...built.init, signal: controller.signal })
    return { status: upstream.status, text: await upstream.text() }
  } catch (e) {
    // AbortController.abort() 抛 AbortError；部分运行时抛 TimeoutError，两者都算超时
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      return json(504, { error: '上游请求超时' })
    }
    return json(502, { error: e?.message ?? UPSTREAM_ERROR })
  } finally {
    clearTimeout(timer)
  }
}

/** 代理 chat/completions。返回 { status, text }。 */
export function proxyChat(body, options) {
  return forward(buildChatRequest(body, options), options)
}

/** 代理 /models。返回 { status, text }。 */
export function proxyModels(body, options) {
  return forward(buildModelsRequest(body, options), options)
}
