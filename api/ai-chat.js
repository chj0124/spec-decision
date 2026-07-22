// Vercel serverless 函数：OpenAI 兼容 chat/completions 代理。
// 前端统一 POST /api/ai-chat { baseUrl, apiKey, model, messages, temperature, ...extra }，
// 由本函数转发到真实服务商，绕开浏览器 CORS。dev 模式则由 vite 插件提供同样的路由。
export const config = { runtime: 'nodejs' }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Method Not Allowed' }))
    return
  }
  try {
    const body =
      typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    const { baseUrl, apiKey, model, messages, temperature, ...extra } = body
    if (!baseUrl || !apiKey || !model) {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: '缺少 baseUrl/apiKey/model' }))
      return
    }
    const targetUrl = `${String(baseUrl).replace(/\/$/, '')}/chat/completions`
    const upstream = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: typeof temperature === 'number' ? temperature : 0.1,
        ...extra,
      }),
    })
    const text = await upstream.text()
    res.statusCode = upstream.status
    res.setHeader('Content-Type', 'application/json')
    res.end(text)
  } catch (e) {
    res.statusCode = 502
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: e?.message ?? '上游请求失败' }))
  }
}
