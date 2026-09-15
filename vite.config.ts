import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { proxyChat, proxyModels } from './shared/aiProxyCore.js'

// 版本号单一来源：package.json。
// 构建时内联成字符串字面量，既不把整个 package.json 打进产物，
// 也避免依赖 JSON 导入在不同构建器下的 default interop 差异。
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
) as { version: string }

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
// 校验与转发逻辑在 shared/aiProxyCore.js，与 Vercel / Cloudflare 部署共用一份。
function aiProxyPlugin(): Plugin {
  return {
    name: 'ai-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || ''
        const isModels = url.startsWith('/api/ai-models')
        const isChat = url.startsWith('/api/ai-chat')
        if (!isModels && !isChat) return next()

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
          const { status, text } = isChat ? await proxyChat(body) : await proxyModels(body)
          res.statusCode = status
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
  // 构建期把 package.json 的版本号内联成常量，前端直接读 __APP_VERSION__
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // 用函数按真实模块 id 分组：数组写法只匹配包名本身，
        // 而 react/react-dom 实际以 `react/jsx-runtime`、`react-dom/client` 等子路径引入，
        // 匹配不到就会产出一个 0 字节的空 vendor chunk。
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('recharts') || id.includes('d3-') || id.includes('victory-vendor')) return 'charts'
          if (id.includes('framer-motion') || id.includes('motion-dom') || id.includes('motion-utils')) return 'motion'
          // 报告导出 PNG 用的 html-to-image 只在点按钮时动态 import，
          // 单独成块，否则会被并进常驻 vendor 变成首屏加载
          if (id.includes('html-to-image')) return 'html-to-image'
          return 'vendor'
        },
      },
    },
  },
})
