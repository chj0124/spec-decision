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

/** 调 AI 对话，返回文本。失败抛错，由调用方回退。 */
export async function chat(prompt: string, system?: string): Promise<string> {
  const c = loadAiConfig()
  if (!c.enabled || !c.apiKey) throw new Error('AI 未配置')

  const resp = await fetch(`${c.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${c.apiKey}`,
    },
    body: JSON.stringify({
      model: c.model,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: prompt },
      ],
      temperature: 0.1, // 单位换算/识别要确定性，低温
    }),
  })
  if (!resp.ok) {
    const t = await resp.text().catch(() => '')
    throw new Error(`AI 请求失败 ${resp.status}: ${t.slice(0, 120)}`)
  }
  const data = await resp.json()
  const text = data?.choices?.[0]?.message?.content
  if (!text) throw new Error('AI 返回为空')
  return String(text)
}
