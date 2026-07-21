import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// 关键：禁用 Node fetch 的系统代理读取。
// 本机有 HTTPS_PROXY=http://127.0.0.1:7897（Clash），Node fetch 默认会走它，
// 导致视觉请求（大 body）失败或超时。清空环境变量强制直连。
delete process.env.HTTP_PROXY
delete process.env.HTTPS_PROXY
delete process.env.http_proxy
delete process.env.https_proxy

// AI 代理 plugin：dev 模式下绕过浏览器 CORS。
// 浏览器 POST /api/ai-chat { baseUrl, apiKey, model, messages, temperature }
// 由 vite dev server（Node 端）转发到真实服务商，响应原样返回。
// 生产模式（Vercel）不走此代理，浏览器直连；若服务商不允许 CORS 需另配 Serverless。
function aiProxyPlugin(): Plugin {
  return {
    name: 'ai-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || ''
        if (!url.startsWith('/api/ai-chat')) {
          return next()
        }
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method Not Allowed')
          return
        }
        try {
          const chunks: Buffer[] = []
          for await (const chunk of req) {
            chunks.push(chunk as Buffer)
          }
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
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
        } catch (e: any) {
          console.error('[ai-proxy] error:', e?.message ?? e)
          res.statusCode = 502
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: e?.message ?? '上游请求失败' }))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), aiProxyPlugin()],
  base: './',
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          charts: ['recharts'],
          motion: ['framer-motion'],
          vendor: ['react', 'react-dom'],
        },
      },
    },
  },
})
