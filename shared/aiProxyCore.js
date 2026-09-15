// AI 代理共享核心。
//
// 同一个 OpenAI 兼容代理契约需要在三处落地：
//   1) 本地开发：vite.config.ts 的 dev middleware
//   2) Vercel：api/ai-chat.js、api/ai-models.js
//   3) Cloudflare：根目录 _worker.js
// 之前这三处各写了一份「校验 + 转发」，规则容易改一处漏两处。
// 现在校验与转发只此一份，各平台只保留极薄的适配层（读请求体、写响应、加 CORS）。
//
// 只依赖标准 fetch / JSON / String，所以 Node（vite / Vercel）与 Workers 运行时都能直接执行。

const DEFAULT_TEMPERATURE = 0.1
const UPSTREAM_ERROR = '上游请求失败'

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl).replace(/\/$/, '')
}

function json(status, payload) {
  return { status, text: JSON.stringify(payload) }
}

/**
 * 由请求体构造 chat/completions 的上游请求。
 * 多余的字段（如豆包的 thinking）原样透传。
 * @returns {{ error: string } | { targetUrl: string, init: object }}
 */
export function buildChatRequest(body) {
  const { baseUrl, apiKey, model, messages, temperature, ...extra } = body || {}
  if (!baseUrl || !apiKey || !model) return { error: '缺少 baseUrl/apiKey/model' }
  return {
    targetUrl: `${normalizeBaseUrl(baseUrl)}/chat/completions`,
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
 * @returns {{ error: string } | { targetUrl: string, init: object }}
 */
export function buildModelsRequest(body) {
  const { baseUrl, apiKey } = body || {}
  if (!baseUrl || !apiKey) return { error: '缺少 baseUrl/apiKey' }
  return {
    targetUrl: `${normalizeBaseUrl(baseUrl)}/models`,
    init: { headers: { Authorization: `Bearer ${apiKey}` } },
  }
}

// 执行转发：不抛错，把上游状态码与正文原样回传，交由适配层决定怎么写响应。
async function forward(built) {
  if (built.error) return json(400, { error: built.error })
  try {
    const upstream = await fetch(built.targetUrl, built.init)
    return { status: upstream.status, text: await upstream.text() }
  } catch (e) {
    return json(502, { error: e?.message ?? UPSTREAM_ERROR })
  }
}

/** 代理 chat/completions。返回 { status, text }。 */
export function proxyChat(body) {
  return forward(buildChatRequest(body))
}

/** 代理 /models。返回 { status, text }。 */
export function proxyModels(body) {
  return forward(buildModelsRequest(body))
}
