// 统一 AI 客户端：OpenAI 兼容协议（DeepSeek / 通义 / 智谱 / OpenAI 均兼容）
// 配置存 localStorage，密钥不离开浏览器。

export interface AiConfig {
  baseUrl: string // 接口地址，如 https://api.deepseek.com/v1
  apiKey: string
  model: string // 如 deepseek-chat / qwen-plus / glm-4 / gpt-4o-mini
  /** 视觉模型（用于截图识别）。留空则用 model。注意 DeepSeek 不支持视觉。 */
  visionModel?: string
  enabled: boolean
}

const KEY = 'spec-decision:ai-config'

export const AI_PRESETS: Array<{ label: string; baseUrl: string; model: string; visionModel: string }> = [
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', visionModel: '' },
  { label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', visionModel: 'qwen-vl-plus' },
  { label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', visionModel: 'glm-4v-flash' },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', visionModel: 'gpt-4o-mini' },
  { label: '自定义', baseUrl: '', model: '', visionModel: '' },
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
        visionModel: c.visionModel ?? '',
        enabled: Boolean(c.enabled && c.apiKey),
      }
    }
  } catch { /* ignore */ }
  return { baseUrl: AI_PRESETS[0].baseUrl, apiKey: '', model: AI_PRESETS[0].model, visionModel: '', enabled: false }
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

/** 是否配了视觉模型（用于截图识别） */
export function isVisionReady(): boolean {
  const c = loadAiConfig()
  return c.enabled && Boolean(c.apiKey && c.baseUrl && (c.visionModel || c.model))
}

/** 取生效的视觉模型名 */
export function getVisionModel(c: AiConfig): string {
  return c.visionModel?.trim() || c.model
}

/**
 * 底层请求：OpenAI 兼容的 chat/completions。
 * messages 已构造好（文本或多模态均可）。model 由调用方指定。
 * dev 模式走 /api/ai-chat 代理，绕过浏览器 CORS。
 */
async function requestChat(
  c: AiConfig,
  model: string,
  messages: any[],
  temperature = 0.1,
  timeoutMs = 90000,
  extraBody?: Record<string, any>,
): Promise<string> {
  const isDev = import.meta.env.DEV
  const url = isDev
    ? '/api/ai-chat'
    : `${c.baseUrl.replace(/\/$/, '')}/chat/completions`

  // 超时控制：视觉模型处理图片可能需要 10-30 秒，给 90 秒上限
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

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
          ? { baseUrl: c.baseUrl, apiKey: c.apiKey, model, messages, temperature, ...extraBody }
          : { model, messages, temperature, ...extraBody },
      ),
      signal: controller.signal,
    })
  } catch (e: any) {
    clearTimeout(timer)
    const reason = e?.message ?? String(e)
    // AbortError = 超时
    if (e?.name === 'AbortError' || /abort/i.test(reason)) {
      throw new Error(`请求超时（${Math.round(timeoutMs / 1000)}秒未响应），可能是模型处理过慢或网络异常。请检查视觉模型是否正确，或重试。`)
    }
    if (/failed to fetch|networkerror|load failed/i.test(reason)) {
      throw new Error(
        isDev
          ? '本地代理请求失败（vite dev server 异常或上游网络不通，请检查 baseUrl 是否正确、代理是否拦截）。'
          : '网络请求失败（可能是 CORS 拦截、地址错误、或该服务商不允许浏览器直连）。',
      )
    }
    throw new Error(`网络请求失败：${reason}`)
  }
  clearTimeout(timer)
  if (!resp.ok) {
    const t = await resp.text().catch(() => '')
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

/** 调 AI 对话，返回文本。失败抛错，由调用方回退。
 *  可传入 overrideConfig 用于"测试连接"等场景（不读 localStorage，直接用表单当前值）。
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
  return requestChat(c, c.model, messages, 0.1)
}

/**
 * 调多模态视觉模型：传图片 base64 + 文字 prompt，返回文本。
 * 用于截图识别。要求模型支持视觉（DeepSeek 不支持，需用 qwen-vl-plus / glm-4v-flash / gpt-4o-mini 等）。
 * 自动加 thinking:false 禁用豆包推理（大幅减少响应时间），其他服务商不受影响。
 */
export async function visionChat(
  prompt: string,
  imageBase64: string,
  imageMime = 'image/jpeg',
  overrideConfig?: AiConfig,
): Promise<string> {
  const c = overrideConfig ?? loadAiConfig()
  if (!c.apiKey || !c.baseUrl) throw new Error('AI 未配置（请先在 AI 设置里填写）')
  const model = getVisionModel(c)
  if (!model) throw new Error('未配置视觉模型')

  const messages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:${imageMime};base64,${imageBase64}` } },
      ],
    },
  ]
  // 禁用豆包推理模式（thinking:{"type":"disabled"}），大幅减少响应时间（实测 17.6s → 7.2s，
  // reasoning tokens 降为 0，识别结果正确）。其他 OpenAI 兼容服务商会忽略此参数，无副作用。
  return requestChat(c, model, messages, 0.1, 90000, { thinking: { type: 'disabled' } })
}
