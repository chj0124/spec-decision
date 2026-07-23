// Cloudflare Pages Function：OpenAI 兼容 GET /models 代理（拉取服务商可用模型列表）。
// 前端统一 POST /api/ai-models { baseUrl, apiKey }，由本函数转发。
// 签名与 Vercel 的 api/ai-models.js 不同（Fetch API vs handler(req,res)），不能混用。
//
// 同 ai-chat.js：使用通用 onRequest，避免 Cloudflare 对 onRequestPost 的 POST 匹配问题导致 405。

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function onRequest(context) {
  const { request } = context

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: '仅支持 POST 方法' }), {
      status: 405,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: '请求体不是合法 JSON' }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  const { baseUrl, apiKey } = body
  if (!baseUrl || !apiKey) {
    return new Response(JSON.stringify({ error: '缺少 baseUrl/apiKey' }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
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
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  const text = await upstream.text()
  return new Response(text, {
    status: upstream.status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
