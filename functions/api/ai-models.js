// Cloudflare Pages Function：OpenAI 兼容 GET /models 代理（拉取服务商可用模型列表）。
// 前端统一 POST /api/ai-models { baseUrl, apiKey }，由本函数转发。
// 签名与 Vercel 的 api/ai-models.js 不同（Fetch API vs handler(req,res)），不能混用。

export async function onRequestPost({ request }) {
  let body
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: '请求体不是合法 JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { baseUrl, apiKey } = body
  if (!baseUrl || !apiKey) {
    return new Response(JSON.stringify({ error: '缺少 baseUrl/apiKey' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const targetUrl = `${String(baseUrl).replace(/\/$/, '')}/models`
  let upstream
  try {
    upstream = await fetch(targetUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message ?? '上游请求失败' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const text = await upstream.text()
  return new Response(text, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  })
}
