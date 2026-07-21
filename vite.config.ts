import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    // AI 代理：dev 模式下绕过浏览器 CORS。
    // 浏览器 POST /api/ai-chat { baseUrl, apiKey, model, messages, temperature }
    // 由 vite dev server（Node 端）转发到真实服务商，响应原样返回。
    configureServer(server) {
      server.middlewares.use('/api/ai-chat', async (req, res) => {
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
          const { baseUrl, apiKey, model, messages, temperature } = body

          if (!baseUrl || !apiKey || !model) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: '缺少 baseUrl/apiKey/model' }))
            return
          }

          const upstream = await fetch(`${String(baseUrl).replace(/\/$/, '')}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model,
              messages,
              temperature: typeof temperature === 'number' ? temperature : 0.1,
            }),
          })

          const text = await upstream.text()
          res.statusCode = upstream.status
          res.setHeader('Content-Type', 'application/json')
          res.end(text)
        } catch (e: any) {
          res.statusCode = 502
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: e?.message ?? '上游请求失败' }))
        }
      })
    },
  },
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
