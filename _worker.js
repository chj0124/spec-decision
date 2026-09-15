// Cloudflare Worker（模块格式）：处理 /api/ai-chat、/api/ai-models 代理；其余回退静态资源（SPA）。
// 同时兼容两种部署：
//   1) Cloudflare Pages advanced mode：仓库根放 _worker.js 即生效，env.ASSETS 自动提供。
//   2) Cloudflare Workers + Static Assets：需 wrangler.toml 配置 [assets] directory="./dist" 与 main="./_worker.js"。
//
// 注意：Cloudflare Workers 不认 Vercel 的 api/handler(req,res)，也不认 Pages 的 functions/ 目录，
// 必须用一个 _worker.js 这样的 Worker 脚本来接管请求。
//
// 校验与转发逻辑在 shared/aiProxyCore.js，与 vite dev 插件、Vercel 函数共用一份；
// 本文件只做 Worker 特有的适配：CORS 头 + Response 包装。

import { proxyChat, proxyModels } from './shared/aiProxyCore.js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function jsonResponse(status, text) {
  return new Response(text, {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

async function handle(request, proxy) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (request.method !== 'POST') {
    return jsonResponse(405, JSON.stringify({ error: '仅支持 POST' }))
  }
  let body
  try {
    body = await request.json()
  } catch {
    return jsonResponse(400, JSON.stringify({ error: '请求体不是合法 JSON' }))
  }
  const { status, text } = await proxy(body)
  return jsonResponse(status, text)
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/api/ai-chat') return handle(request, proxyChat)
    if (url.pathname === '/api/ai-models') return handle(request, proxyModels)
    // 静态资源 + SPA 回退。Cloudflare 会提供 env.ASSETS 绑定（Pages 与 Workers Static Assets 均支持）。
    if (env && env.ASSETS) return env.ASSETS.fetch(request)
    // 极端兜底：无 ASSETS 绑定时返回首页（避免整站 404）
    return new Response('Not Found', { status: 404 })
  },
}
