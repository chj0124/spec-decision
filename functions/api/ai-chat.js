// Cloudflare Pages Function：OpenAI 兼容 chat/completions 代理。
// 前端统一 POST /api/ai-chat { baseUrl, apiKey, model, messages, temperature, ...extra }，
// 由本函数转发到真实服务商，绕开浏览器 CORS。
//
// 注意：Cloudflare Pages Functions 使用 Fetch API（Request/Response），
// 与 Vercel 的 api/ai-chat.js（handler(req, res) Node 签名）不同，二者不能混用。
//
// 关键修复：必须使用通用 onRequest（而非 onRequestPost）。Cloudflare 在某些情况下
// 对方法专属 handler（onRequestPost）的 POST 匹配不稳，会回 405（空 body）。
// 用 onRequest 兜住所有方法，自己判方法，避免被平台甩 405。

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function onRequest(context) {
  const { request } = context

  // CORS 预检（浏览器跨域才会发；同源一般跳过，但兜底处理无妨）
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

  const { baseUrl, apiKey, model, messages, temperature, ...extra } = body
  if (!baseUrl || !apiKey || !model) {
    return new Response(JSON.stringify({ error: '缺少 baseUrl/apiKey/model' }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  const targetUrl = `${String(baseUrl).replace(/\/$/, '')}/chat/completions`
  let upstream
  try {
    upstream = await fetch(targetUrl, {
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
