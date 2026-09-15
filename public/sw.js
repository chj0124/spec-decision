/* 规格决策台 Service Worker：网络优先 + 离线兜底。
   策略刻意保持简单 —— 在线时永远取最新内容（避免旧缓存卡住更新），
   仅在离线/网络失败时回退到上一次成功缓存的副本。 */

const CACHE = 'spec-decision-runtime-v1'
const OFFLINE_FALLBACK = './index.html'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.includes('/api/')) return

  event.respondWith((async () => {
    try {
      const res = await fetch(request)
      if (res && res.ok && res.status !== 206 && res.type === 'basic') {
        const cache = await caches.open(CACHE)
        cache.put(request, res.clone())
      }
      return res
    } catch {
      const cached = await caches.match(request)
      if (cached) return cached
      const fallback = await caches.match(OFFLINE_FALLBACK)
      if (fallback) return fallback
      throw new Error('offline')
    }
  })())
})
