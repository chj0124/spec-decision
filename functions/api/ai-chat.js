// Cloudflare Pages Function：OpenAI 兼容 chat/completions 代理。
// 前端统一 POST /api/ai-chat { baseUrl, apiKey, model, messages, temperature, ...extra }，
// 由本函数转发到真实服务商，绕开浏览器 CORS。
//
// 注意：Cloudflare Pages Functions 使用 Fetch API（Request/Response），
// 与 Vercel 的 api/ai-chat.js（handler(req, res) Node 签名）不同，二者不能混用。
// 部署到 Cloudflare 时，请确保 Cloudflare 仪表盘的「Functions 目录」为默认的 functions/。

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

  const { baseUrl, apiKey, model, messages, temperature, ...extra } = body
  if (!baseUrl || !apiKey || !model) {
    return new Response(JSON.stringify({ error: '缺少 baseUrl/apiKey/model' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const text = await upstream.text()
  return new Response(text, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  })
}
