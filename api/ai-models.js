// Vercel serverless 函数：OpenAI 兼容 GET /models 代理。
// 前端统一 POST /api/ai-models { baseUrl, apiKey }，由本函数转发，绕开浏览器 CORS。
// 校验与转发逻辑在 shared/aiProxyCore.js，与 vite dev 插件、Cloudflare worker 共用一份。
import { isPayloadTooLarge, isTextTooLarge, proxyModels } from '../shared/aiProxyCore.js'

export const config = { runtime: 'nodejs' }

function send(res, status, payload) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(typeof payload === 'string' ? payload : JSON.stringify(payload))
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    send(res, 405, { error: 'Method Not Allowed' })
    return
  }

  // 体积预检：Content-Length 可信时直接拒绝，避免读入超大 body
  if (isPayloadTooLarge(req.headers['content-length'])) {
    send(res, 413, { error: '请求体过大' })
    return
  }

  let body = req.body
  if (typeof body === 'string') {
    // 读入后再校验一次（Content-Length 缺失或伪造时的兜底）
    if (isTextTooLarge(body)) {
      send(res, 413, { error: '请求体过大' })
      return
    }
    try {
      body = JSON.parse(body)
    } catch {
      send(res, 400, { error: '请求体不是合法 JSON' })
      return
    }
  }

  // 超时（504）与上游异常（502）由 aiProxyCore.forward 统一处理
  const { status, text } = await proxyModels(body || {})
  send(res, status, text)
}
