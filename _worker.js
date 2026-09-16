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
//
// ── CORS 策略（A3）──────────────────────────────────────────────────────────
//   绝不回 `Access-Control-Allow-Origin: *`（那等于把代理开放给任意站点）。
//   仅当请求 Origin 命中「同源」或 CORS_ALLOWED_ORIGINS 白名单时，才回显该 Origin。
//   需要额外放行的站点，在 Worker 环境变量里配置 CORS_ALLOWED_ORIGINS（逗号分隔）。

import { isPayloadTooLarge, isTextTooLarge, proxyChat, proxyModels } from './shared/aiProxyCore.js'

/** 允许的跨域来源 = 本站源 + 环境变量白名单 */
function resolveAllowedOrigins(request, env) {
  const self = new URL(request.url).origin
  const extra = String((env && env.CORS_ALLOWED_ORIGINS) || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return new Set([self, ...extra])
}

/** 生成 CORS 头：无 Origin 或非白名单来源不产生 Allow-Origin（浏览器据此拦截） */
function corsHeaders(request, env) {
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
  const origin = request.headers.get('Origin')
  if (origin && resolveAllowedOrigins(request, env).has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  return headers
}

function jsonResponse(status, text, request, env) {
  return new Response(text, {
    status,
    headers: { ...corsHeaders(request, env), 'Content-Type': 'application/json' },
  })
}

async function handle(request, env, proxy) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) })
  }
  if (request.method !== 'POST') {
    return jsonResponse(405, JSON.stringify({ error: '仅支持 POST' }), request, env)
  }
  // 体积预检：Content-Length 可信时直接拒绝，避免读入超大 body
  if (isPayloadTooLarge(request.headers.get('content-length'))) {
    return jsonResponse(413, JSON.stringify({ error: '请求体过大' }), request, env)
  }
  // 先取原文再解析：便于在 JSON.parse 之前按字节数兜底校验
  const raw = await request.text()
  if (isTextTooLarge(raw)) {
    return jsonResponse(413, JSON.stringify({ error: '请求体过大' }), request, env)
  }
  let body
  try {
    body = JSON.parse(raw)
  } catch {
    return jsonResponse(400, JSON.stringify({ error: '请求体不是合法 JSON' }), request, env)
  }
  // 超时（504）与上游异常（502）由 aiProxyCore.forward 统一处理
  const { status, text } = await proxy(body)
  return jsonResponse(status, text, request, env)
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/api/ai-chat') return handle(request, env, proxyChat)
    if (url.pathname === '/api/ai-models') return handle(request, env, proxyModels)
    // 静态资源 + SPA 回退。Cloudflare 会提供 env.ASSETS 绑定（Pages 与 Workers Static Assets 均支持）。
    if (env && env.ASSETS) return env.ASSETS.fetch(request)
    // 极端兜底：无 ASSETS 绑定时返回首页（避免整站 404）
    return new Response('Not Found', { status: 404 })
  },
}
