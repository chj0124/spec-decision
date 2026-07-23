// Cloudflare Worker（模块格式）：处理 /api/ai-chat、/api/ai-models 代理；其余回退静态资源（SPA）。
// 同时兼容两种部署：
//   1) Cloudflare Pages advanced mode：仓库根放 _worker.js 即生效，env.ASSETS 自动提供。
//   2) Cloudflare Workers + Static Assets：需 wrangler.toml 配置 [assets] directory="./dist" 与 main="./_worker.js"。
//
// 注意：Cloudflare Workers 不认 Vercel 的 api/handler(req,res)，也不认 Pages 的 functions/ 目录，
// 必须用一个 _worker.js 这样的 Worker 脚本来接管请求。

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

async function handleChat(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: '仅支持 POST' }), {
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
  try {
    const upstream = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages,
        temperature: typeof temperature === 'number' ? temperature : 0.1,
        ...extra,
      }),
    })
    const text = await upstream.text()
    return new Response(text, {
      status: upstream.status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message ?? '上游请求失败' }), {
      status: 502,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
}

async function handleModels(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: '仅支持 POST' }), {
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
  try {
    const upstream = await fetch(targetUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    const text = await upstream.text()
    return new Response(text, {
      status: upstream.status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message ?? '上游请求失败' }), {
      status: 502,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/api/ai-chat') return handleChat(request)
    if (url.pathname === '/api/ai-models') return handleModels(request)
    // 静态资源 + SPA 回退。Cloudflare 会提供 env.ASSETS 绑定（Pages 与 Workers Static Assets 均支持）。
    if (env && env.ASSETS) return env.ASSETS.fetch(request)
    // 极端兜底：无 ASSETS 绑定时返回首页（避免整站 404）
    return new Response('Not Found', { status: 404 })
  },
}
