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

export const AI_PRESETS: Array<{ label: string; baseUrl: string; model: string; visionModel: string; consoleUrl: string }> = [
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', visionModel: '', consoleUrl: 'https://platform.deepseek.com/api_keys' },
  { label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', visionModel: 'qwen-vl-plus', consoleUrl: 'https://bailian.console.aliyun.com/?apiKey=1#/api-key' },
  { label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', visionModel: 'glm-4v-flash', consoleUrl: 'https://open.bigmodel.cn/usercenter/apikeys' },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', visionModel: 'gpt-4o-mini', consoleUrl: 'https://platform.openai.com/api-keys' },
  { label: '自定义', baseUrl: '', model: '', visionModel: '', consoleUrl: '' },
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
 * 统一走同源代理 /api/ai-chat：dev 由 vite 插件转发，生产由 serverless 函数（Vercel）转发，
 * 以此绕过浏览器 CORS。纯静态托管（无代理函数）会优雅失败，由调用方回退到内置示例。
 */
async function requestChat(
  c: AiConfig,
  model: string,
  messages: any[],
  temperature = 0.1,
  timeoutMs = 90000,
  extraBody?: Record<string, any>,
): Promise<string> {
  // 同源代理：dev / 生产一致，凭据放在 body 里由代理转发
  const url = '/api/ai-chat'

  // 超时控制：视觉模型处理图片可能需要 10-30 秒，给 90 秒上限
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let resp: Response
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: c.baseUrl,
        apiKey: c.apiKey,
        model,
        messages,
        temperature,
        ...extraBody,
      }),
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
        'AI 代理未连接：请确认本地开发服务器（npm run dev）正在运行；线上环境若未部署代理函数，将自动回退到内置示例。',
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
  const data = await resp.json().catch(() => null)
  const text = data?.choices?.[0]?.message?.content
  if (!text) throw new Error('AI 返回为空（代理未正确部署或被拦截）')
  return String(text)
}

/** 调 AI 对话，返回文本。失败抛错，由调用方回退。
 *  可传入 overrideConfig 用于"测试连接"等场景（不读 localStorage，直接用表单当前值）。
 *  extraBody 透传到上游请求体（如豆包禁用推理 { thinking: { type: 'disabled' } }）；
 *  timeoutMs 覆盖默认超时（默认 90s，生成类任务用更长）。
 */
export async function chat(
  prompt: string,
  system?: string,
  overrideConfig?: AiConfig,
  extraBody?: Record<string, any>,
  timeoutMs?: number,
): Promise<string> {
  const c = overrideConfig ?? loadAiConfig()
  if (!c.apiKey || !c.baseUrl || !c.model) throw new Error('AI 未配置（请填写 Base URL / API Key / Model）')

  const messages = [
    ...(system ? [{ role: 'system', content: system }] : []),
    { role: 'user', content: prompt },
  ]
  return requestChat(c, c.model, messages, 0.1, timeoutMs ?? 90000, extraBody)
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

/**
 * 拉取服务商可用模型列表（OpenAI 兼容 GET /models）。
 * 用于"获取可用模型"按钮，避免用户手动查文档填模型名。
 */
export async function listModels(overrideConfig?: AiConfig): Promise<string[]> {
  const c = overrideConfig ?? loadAiConfig()
  if (!c.apiKey || !c.baseUrl) throw new Error('请先填写 Base URL 和 API Key')

  // 同源代理 /api/ai-models（dev = vite 插件；生产 = serverless 函数）
  const url = '/api/ai-models'

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)

  let resp: Response
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: c.baseUrl, apiKey: c.apiKey }),
      signal: controller.signal,
    })
  } catch (e: any) {
    clearTimeout(timer)
    throw new Error('AI 代理未连接：请确认本地开发服务器正在运行，或线上已部署代理函数。')
  }
  clearTimeout(timer)
  if (!resp.ok) {
    const t = await resp.text().catch(() => '')
    throw new Error(`获取模型失败 ${resp.status}: ${t.slice(0, 120)}`)
  }
  const data = await resp.json().catch(() => null)
  const list: string[] = (data?.data ?? []).map((m: any) => m.id).filter(Boolean)
  if (list.length === 0) throw new Error('服务商未返回模型列表（代理未正确部署？）')
  return list.sort()
}
