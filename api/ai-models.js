// Vercel serverless 函数：OpenAI 兼容 GET /models 代理。
// 前端统一 POST /api/ai-models { baseUrl, apiKey }，由本函数转发，绕开浏览器 CORS。
export const config = { runtime: 'nodejs' }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Method Not Allowed' }))
    return
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    const { baseUrl, apiKey } = body
    if (!baseUrl || !apiKey) {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: '缺少 baseUrl/apiKey' }))
      return
    }
    const targetUrl = `${String(baseUrl).replace(/\/$/, '')}/models`
    const upstream = await fetch(targetUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
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
