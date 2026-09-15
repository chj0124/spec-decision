// Vercel serverless 函数：OpenAI 兼容 chat/completions 代理。
// 前端统一 POST /api/ai-chat { baseUrl, apiKey, model, messages, temperature, ...extra }，
// 由本函数转发到真实服务商，绕开浏览器 CORS。
// 校验与转发逻辑在 shared/aiProxyCore.js，与 vite dev 插件、Cloudflare worker 共用一份。
import { proxyChat } from '../shared/aiProxyCore.js'

export const config = { runtime: 'nodejs' }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Method Not Allowed' }))
    return
  }

  let body = req.body
  try {
    if (typeof body === 'string') body = JSON.parse(body)
  } catch {
    res.statusCode = 400
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: '请求体不是合法 JSON' }))
    return
  }

  const { status, text } = await proxyChat(body || {})
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(text)
}
