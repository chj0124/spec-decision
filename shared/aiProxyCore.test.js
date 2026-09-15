import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildChatRequest, buildModelsRequest, proxyChat, proxyModels } from './aiProxyCore.js'

// 这份核心被三处部署共用（vite dev 中间件 / Vercel 函数 / Cloudflare worker），
// 所以契约要锁死：缺字段一律 400，上游状态与正文原样透传，上游异常一律 502。

describe('buildChatRequest', () => {
  it('缺少 model 时返回错误', () => {
    expect(buildChatRequest({ baseUrl: 'https://x/v1', apiKey: 'k' }).error).toBe(
      '缺少 baseUrl/apiKey/model',
    )
  })

  it('去掉 baseUrl 结尾斜杠并拼 /chat/completions', () => {
    const built = buildChatRequest({ baseUrl: 'https://x/v1/', apiKey: 'k', model: 'm' })
    expect(built.targetUrl).toBe('https://x/v1/chat/completions')
  })

  it('temperature 缺省为 0.1，显式值则保留', () => {
    const def = buildChatRequest({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' })
    expect(JSON.parse(def.init.body).temperature).toBe(0.1)

    const custom = buildChatRequest({
      baseUrl: 'https://x/v1',
      apiKey: 'k',
      model: 'm',
      temperature: 0.7,
    })
    expect(JSON.parse(custom.init.body).temperature).toBe(0.7)
  })

  it('把额外字段透传给上游（如豆包 thinking）', () => {
    const built = buildChatRequest({
      baseUrl: 'https://x/v1',
      apiKey: 'k',
      model: 'm',
      thinking: { type: 'disabled' },
    })
    expect(JSON.parse(built.init.body).thinking).toEqual({ type: 'disabled' })
  })

  it('带上 Bearer 鉴权头', () => {
    const built = buildChatRequest({ baseUrl: 'https://x/v1', apiKey: 'sk-1', model: 'm' })
    expect(built.init.headers.Authorization).toBe('Bearer sk-1')
  })
})

describe('buildModelsRequest', () => {
  it('缺少 apiKey 时返回错误', () => {
    expect(buildModelsRequest({ baseUrl: 'https://x/v1' }).error).toBe('缺少 baseUrl/apiKey')
  })

  it('指向 /models 且不显式指定 method（走 GET）', () => {
    const built = buildModelsRequest({ baseUrl: 'https://x/v1/', apiKey: 'k' })
    expect(built.targetUrl).toBe('https://x/v1/models')
    expect(built.init.method).toBeUndefined()
  })
})

describe('转发行为', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('透传上游状态码与正文', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}', { status: 201 })))
    const res = await proxyChat({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' })
    expect(res).toEqual({ status: 201, text: '{"ok":true}' })
  })

  it('上游抛错时返回 502 并带出原因', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('boom')
    }))
    const res = await proxyModels({ baseUrl: 'https://x/v1', apiKey: 'k' })
    expect(res.status).toBe(502)
    expect(JSON.parse(res.text).error).toBe('boom')
  })

  it('校验失败时不发起上游请求', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const res = await proxyChat({})
    expect(res.status).toBe(400)
    expect(spy).not.toHaveBeenCalled()
  })
})
