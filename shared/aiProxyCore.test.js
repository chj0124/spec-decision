import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_BODY_BYTES,
  UPSTREAM_TIMEOUT_MS,
  buildChatRequest,
  buildModelsRequest,
  isPayloadTooLarge,
  isTextTooLarge,
  proxyChat,
  proxyModels,
  utf8ByteLength,
  validateBaseUrl,
} from './aiProxyCore.js'

// 这份核心被三处部署共用（vite dev 中间件 / Vercel 函数 / Cloudflare worker），
// 所以契约要锁死：缺字段一律 400，非白名单主机一律 403，SSRF 目标一律 400，
// 上游状态与正文原样透传，上游异常一律 502、超时一律 504。

const HOST = 'https://api.deepseek.com/v1'

describe('buildChatRequest', () => {
  it('缺少 model 时返回错误', () => {
    const res = buildChatRequest({ baseUrl: HOST, apiKey: 'k' })
    expect(res.error).toBe('缺少 baseUrl/apiKey/model')
    expect(res.status).toBe(400)
  })

  it('去掉 baseUrl 结尾斜杠并拼 /chat/completions', () => {
    const built = buildChatRequest({ baseUrl: `${HOST}/`, apiKey: 'k', model: 'm' })
    expect(built.targetUrl).toBe('https://api.deepseek.com/v1/chat/completions')
  })

  it('temperature 缺省为 0.1，显式值则保留', () => {
    const def = buildChatRequest({ baseUrl: HOST, apiKey: 'k', model: 'm' })
    expect(JSON.parse(def.init.body).temperature).toBe(0.1)

    const custom = buildChatRequest({
      baseUrl: HOST,
      apiKey: 'k',
      model: 'm',
      temperature: 0.7,
    })
    expect(JSON.parse(custom.init.body).temperature).toBe(0.7)
  })

  it('把额外字段透传给上游（如豆包 thinking）', () => {
    const built = buildChatRequest({
      baseUrl: HOST,
      apiKey: 'k',
      model: 'm',
      thinking: { type: 'disabled' },
    })
    expect(JSON.parse(built.init.body).thinking).toEqual({ type: 'disabled' })
  })

  it('带上 Bearer 鉴权头', () => {
    const built = buildChatRequest({ baseUrl: HOST, apiKey: 'sk-1', model: 'm' })
    expect(built.init.headers.Authorization).toBe('Bearer sk-1')
  })
})

describe('buildModelsRequest', () => {
  it('缺少 apiKey 时返回错误', () => {
    const res = buildModelsRequest({ baseUrl: HOST })
    expect(res.error).toBe('缺少 baseUrl/apiKey')
    expect(res.status).toBe(400)
  })

  it('指向 /models 且不显式指定 method（走 GET）', () => {
    const built = buildModelsRequest({ baseUrl: `${HOST}/`, apiKey: 'k' })
    expect(built.targetUrl).toBe('https://api.deepseek.com/v1/models')
    expect(built.init.method).toBeUndefined()
  })
})

describe('validateBaseUrl 主机白名单', () => {
  it('白名单内主机通过并保留路径', () => {
    expect(validateBaseUrl('https://dashscope.aliyuncs.com/compatible-mode/v1')).toEqual({
      base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    })
  })

  it('大小写与结尾点号归一化后仍命中白名单', () => {
    expect(validateBaseUrl('https://API.DeepSeek.com/v1')?.base).toBe(
      'https://api.deepseek.com/v1',
    )
  })

  it('丢弃 query / hash，避免参数注入', () => {
    expect(validateBaseUrl('https://api.deepseek.com/v1?a=1#x')?.base).toBe(
      'https://api.deepseek.com/v1',
    )
  })

  it('白名单外主机返回 403', () => {
    const res = validateBaseUrl('https://evil.example.com/v1')
    expect(res.status).toBe(403)
    expect(res.error).toContain('未在允许列表中')
  })

  it('可通过 options.allowedHosts 追加自建网关（支持 * 通配）', () => {
    expect(
      validateBaseUrl('https://gateway.mycorp.io/v1', { allowedHosts: ['*.mycorp.io'] })?.base,
    ).toBe('https://gateway.mycorp.io/v1')
  })

  it('可通过 AI_PROXY_ALLOWED_HOSTS 环境变量追加主机', () => {
    process.env.AI_PROXY_ALLOWED_HOSTS = 'gateway.mycorp.io'
    try {
      expect(validateBaseUrl('https://gateway.mycorp.io/v1')?.base).toBe(
        'https://gateway.mycorp.io/v1',
      )
    } finally {
      delete process.env.AI_PROXY_ALLOWED_HOSTS
    }
  })
})

describe('validateBaseUrl SSRF 防线', () => {
  const mustReject400 = [
    ['云元数据地址', 'https://169.254.169.254/latest/meta-data'],
    ['环回地址', 'https://127.0.0.1/v1'],
    ['私网 10 段', 'https://10.0.0.1/v1'],
    ['私网 172.16 段', 'https://172.16.5.5/v1'],
    ['私网 192.168 段', 'https://192.168.1.1/v1'],
    ['IPv4-mapped IPv6 元数据', 'https://[::ffff:169.254.169.254]/v1'],
    ['IPv6 环回', 'https://[::1]/v1'],
    ['无点内部主机名', 'https://localhost/v1'],
    ['file 协议', 'file:///etc/passwd'],
    ['gopher 协议', 'gopher://127.0.0.1:11211/_x'],
    ['http 明文', 'http://api.deepseek.com/v1'],
    ['内嵌凭据', 'https://u:p@api.deepseek.com/v1'],
    ['显式端口', 'https://api.deepseek.com:8443/v1'],
    ['空值', ''],
  ]

  it.each(mustReject400)('%s 返回 400', (_name, url) => {
    const res = validateBaseUrl(url)
    expect(res.status).toBe(400)
    expect(res.error).toBeTruthy()
  })
})

describe('isPayloadTooLarge', () => {
  it('超过上限返回 true，未超过或缺失返回 false', () => {
    expect(isPayloadTooLarge(MAX_BODY_BYTES + 1)).toBe(true)
    expect(isPayloadTooLarge(MAX_BODY_BYTES)).toBe(false)
    expect(isPayloadTooLarge(undefined)).toBe(false)
    expect(isPayloadTooLarge('not-a-number')).toBe(false)
  })
})

describe('isTextTooLarge / utf8ByteLength', () => {
  it('按 UTF-8 字节数而非字符数计（中文 3 字节）', () => {
    expect(utf8ByteLength('a')).toBe(1)
    expect(utf8ByteLength('中')).toBe(3)
    expect(utf8ByteLength(undefined)).toBe(0)
  })

  it('已读入正文超过字节上限返回 true', () => {
    expect(isTextTooLarge('a'.repeat(MAX_BODY_BYTES))).toBe(false)
    expect(isTextTooLarge('a'.repeat(MAX_BODY_BYTES + 1))).toBe(true)
    expect(isTextTooLarge('中'.repeat(MAX_BODY_BYTES / 3 + 1))).toBe(true)
  })
})

describe('转发行为', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('透传上游状态码与正文', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}', { status: 201 })))
    const res = await proxyChat({ baseUrl: HOST, apiKey: 'k', model: 'm' })
    expect(res).toEqual({ status: 201, text: '{"ok":true}' })
  })

  it('上游抛错时返回 502 并带出原因', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('boom')
    }))
    const res = await proxyModels({ baseUrl: HOST, apiKey: 'k' })
    expect(res.status).toBe(502)
    expect(JSON.parse(res.text).error).toBe('boom')
  })

  it('上游超时返回 504', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const err = new Error('timeout')
      err.name = 'TimeoutError'
      throw err
    }))
    const res = await proxyChat({ baseUrl: HOST, apiKey: 'k', model: 'm' })
    expect(res.status).toBe(504)
  })

  it('上游挂起时按 UPSTREAM_TIMEOUT_MS 超时返回 504（fake timer）', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => {
        // 永不 resolve，只对 abort 作出反应——模拟上游完全挂起
        init.signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })))

      const pending = proxyChat({ baseUrl: HOST, apiKey: 'k', model: 'm' })
      await vi.advanceTimersByTimeAsync(UPSTREAM_TIMEOUT_MS)
      const res = await pending

      expect(res.status).toBe(504)
      expect(JSON.parse(res.text).error).toBe('上游请求超时')
    } finally {
      vi.useRealTimers()
    }
  })

  it('options.timeoutMs 可覆盖默认超时', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })))

      const pending = proxyModels({ baseUrl: HOST, apiKey: 'k' }, { timeoutMs: 50 })
      await vi.advanceTimersByTimeAsync(49)
      // 未到点不该结束
      expect(vi.getTimerCount()).toBe(1)
      await vi.advanceTimersByTimeAsync(1)
      expect((await pending).status).toBe(504)
    } finally {
      vi.useRealTimers()
    }
  })

  it('校验失败时不发起上游请求', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const res = await proxyChat({})
    expect(res.status).toBe(400)
    expect(spy).not.toHaveBeenCalled()
  })

  it('非白名单主机不发起上游请求', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const res = await proxyChat({ baseUrl: 'https://evil.example.com/v1', apiKey: 'k', model: 'm' })
    expect(res.status).toBe(403)
    expect(spy).not.toHaveBeenCalled()
  })
})
