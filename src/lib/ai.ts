// 统一 AI 客户端：OpenAI 兼容协议（DeepSeek / 通义 / 智谱 / OpenAI 均兼容）
// 配置存 localStorage，密钥不离开浏览器。

export interface AiConfig {
  baseUrl: string // 接口地址，如 https://api.deepseek.com/v1
  apiKey: string
  model: string // 如 deepseek-chat / qwen-plus / glm-4 / gpt-4o-mini
  enabled: boolean
}

const KEY = 'spec-decision:ai-config'

export const AI_PRESETS: Array<{ label: string; baseUrl: string; model: string }> = [
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { label: '自定义', baseUrl: '', model: '' },
]

export function loadAiConfig(): AiConfig {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const c = JSON.parse(raw)
      return {
        baseUrl: c.baseUrl ?? '',
        apiKey: c.apiKey ?? '',
        model: c.model ?? '',
        enabled: Boolean(c.enabled && c.apiKey),
      }
    }
  } catch { /* ignore */ }
  return { baseUrl: AI_PRESETS[0].baseUrl, apiKey: '', model: AI_PRESETS[0].model, enabled: false }
}

export function saveAiConfig(c: AiConfig) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c))
  } catch { /* ignore */ }
}

export function isAiReady(): boolean {
  const c = loadAiConfig()
  return c.enabled && Boolean(c.apiKey && c.baseUrl && c.model)
}

/** 调 AI 对话，返回文本。失败抛错，由调用方回退。
 *  可传入 overrideConfig 用于"测试连接"等场景（不读 localStorage，直接用表单当前值）。
 *
 *  CORS 策略：
 *  - dev 模式：走 vite dev server 的 /api/ai-chat 代理（Node 端转发），完全绕过浏览器 CORS。
 *  - 生产模式：浏览器直连服务商。若服务商不允许浏览器 CORS，需在 Vercel 配 Serverless 代理。
 */
export async function chat(
  prompt: string,
  system?: string,
  overrideConfig?: AiConfig,
): Promise<string> {
  const c = overrideConfig ?? loadAiConfig()
  if (!c.apiKey || !c.baseUrl || !c.model) throw new Error('AI 未配置（请填写 Base URL / API Key / Model）')

  const messages = [
    ...(system ? [{ role: 'system', content: system }] : []),
    { role: 'user', content: prompt },
  ]

  // dev 模式走本地 vite 代理；生产直连
  const isDev = import.meta.env.DEV
  const url = isDev
    ? '/api/ai-chat'
    : `${c.baseUrl.replace(/\/$/, '')}/chat/completions`

  let resp: Response
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: isDev
        ? { 'Content-Type': 'application/json' }
        : {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${c.apiKey}`,
          },
      body: JSON.stringify(
        isDev
          ? {
              baseUrl: c.baseUrl,
              apiKey: c.apiKey,
              model: c.model,
              messages,
              temperature: 0.1, // 单位换算/识别要确定性，低温
            }
          : {
              model: c.model,
              messages,
              temperature: 0.1,
            },
      ),
    })
  } catch (e: any) {
    // 浏览器 fetch 抛出的网络错误（CORS / DNS / 断网）通常是 TypeError: Failed to fetch
    const reason = e?.message ?? String(e)
    if (/failed to fetch|networkerror|load failed/i.test(reason)) {
      throw new Error(
        isDev
          ? '本地代理请求失败（vite dev server 异常，请重启 npm run dev）。'
          : '网络请求失败（可能是 CORS 拦截、地址错误、或该服务商不允许浏览器直连）。',
      )
    }
    throw new Error(`网络请求失败：${reason}`)
  }
  if (!resp.ok) {
    const t = await resp.text().catch(() => '')
    // 代理把上游错误原样透传，可能 body 是 { error: "..." }，也可能是上游原始 JSON
    let detail = t
    try {
      const j = JSON.parse(t)
      detail = j.error?.message || j.error || j.message || t
    } catch { /* 非 JSON 就用原文 */ }
    throw new Error(`AI 请求失败 ${resp.status}: ${String(detail).slice(0, 160)}`)
  }
  const data = await resp.json()
  const text = data?.choices?.[0]?.message?.content
  if (!text) throw new Error('AI 返回为空')
  return String(text)
}
