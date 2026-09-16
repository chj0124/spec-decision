import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler, {
  MAX_BODY_BYTES,
  MAX_IMAGE_CHARS,
  MAX_PROMPT_CHARS,
  RATE_LIMIT_MAX,
  extractToken,
  isOriginAllowed,
  parseItems,
} from './recognize'

const TOKEN = 'test-token-123456'

/** 构造 qwen（DashScope）上游成功响应 */
function qwenOk(text: string): Response {
  const payload = { output: { choices: [{ message: { content: [{ text }] } }] } }
  return new Response(JSON.stringify(payload), { status: 200 })
}

function post(body: unknown, headers: Record<string, string> = {}, raw?: string) {
  return new Request('https://app.example.com/api/recognize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: raw ?? JSON.stringify(body),
  })
}

function withAuth(headers: Record<string, string> = {}) {
  return { Authorization: `Bearer ${TOKEN}`, ...headers }
}

beforeEach(() => {
  process.env.RECOGNIZE_TOKEN = TOKEN
  delete process.env.RECOGNIZE_ALLOWED_ORIGINS
  delete process.env.RECOGNIZE_PROVIDER
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.RECOGNIZE_TOKEN
  delete process.env.RECOGNIZE_ALLOWED_ORIGINS
  delete process.env.RECOGNIZE_PROVIDER
})

describe('鉴权与开关', () => {
  it('非 POST 返回 405', async () => {
    const res = await handler(new Request('https://app.example.com/api/recognize', { method: 'GET' }))
    expect(res.status).toBe(405)
  })

  it('未配置 RECOGNIZE_TOKEN 时端点默认关闭返回 503', async () => {
    delete process.env.RECOGNIZE_TOKEN
    const res = await handler(post({ image: 'aGk=' }, withAuth()))
    expect(res.status).toBe(503)
  })

  it('令牌错误返回 401', async () => {
    const res = await handler(post({ image: 'aGk=' }, { Authorization: 'Bearer wrong' }))
    expect(res.status).toBe(401)
  })

  it('缺少令牌返回 401', async () => {
    const res = await handler(post({ image: 'aGk=' }))
    expect(res.status).toBe(401)
  })

  it('x-recognize-token 亦可鉴权', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => qwenOk('[]')))
    const res = await handler(post({ image: 'aGk=', prompt: 'p' }, { 'x-recognize-token': TOKEN }))
    expect(res.status).toBe(200)
  })
})

describe('来源白名单', () => {
  it('配置后来源不匹配返回 403', async () => {
    process.env.RECOGNIZE_ALLOWED_ORIGINS = 'app.example.com'
    const res = await handler(post({ image: 'aGk=' }, withAuth({ Origin: 'https://evil.com' })))
    expect(res.status).toBe(403)
  })

  it('配置后来源匹配放行', async () => {
    process.env.RECOGNIZE_ALLOWED_ORIGINS = '*.example.com'
    vi.stubGlobal('fetch', vi.fn(async () => qwenOk('[]')))
    const res = await handler(post({ image: 'aGk=' }, withAuth({ Origin: 'https://app.example.com' })))
    expect(res.status).toBe(200)
  })
})

describe('限流与体积', () => {
  it('超过阈值返回 413（content-length 预检）', async () => {
    const headers = withAuth({
      'x-forwarded-for': '9.9.9.9',
      'content-length': String(MAX_BODY_BYTES + 1),
    })
    const res = await handler(post({ image: 'aGk=' }, headers))
    expect(res.status).toBe(413)
  })

  it('图片字符串超长返回 413', async () => {
    const headers = withAuth({ 'x-forwarded-for': '8.8.8.8' })
    const res = await handler(post({ image: 'a'.repeat(MAX_IMAGE_CHARS + 1) }, headers))
    expect(res.status).toBe(413)
  })

  it('prompt 过长返回 400', async () => {
    const headers = withAuth({ 'x-forwarded-for': '7.7.7.7' })
    const res = await handler(post({ image: 'aGk=', prompt: 'a'.repeat(MAX_PROMPT_CHARS + 1) }, headers))
    expect(res.status).toBe(400)
  })

  it('超过限流阈值返回 429', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => qwenOk('[]')))
    const headers = withAuth({ 'x-forwarded-for': '6.6.6.6' })
    let last = 0
    for (let i = 0; i <= RATE_LIMIT_MAX; i++) {
      const res = await handler(post({ image: 'aGk=' }, headers))
      last = res.status
    }
    expect(last).toBe(429)
  })
})

describe('输入校验与上游异常', () => {
  it('缺少 image 返回 400', async () => {
    const res = await handler(post({ prompt: 'p' }, withAuth({ 'x-forwarded-for': '5.5.5.5' })))
    expect(res.status).toBe(400)
  })

  it('非法 JSON 返回 400', async () => {
    const res = await handler(post({}, withAuth({ 'x-forwarded-for': '4.4.4.4' }), '{not json'))
    expect(res.status).toBe(400)
  })

  it('未实现的 provider 返回 501 而非 500', async () => {
    process.env.RECOGNIZE_PROVIDER = 'gemini'
    const res = await handler(post({ image: 'aGk=' }, withAuth({ 'x-forwarded-for': '3.3.3.3' })))
    expect(res.status).toBe(501)
  })

  it('上游抛错返回 502 而不是裸抛 500', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('socket hang up')
    }))
    const res = await handler(post({ image: 'aGk=' }, withAuth({ 'x-forwarded-for': '2.2.2.2' })))
    expect(res.status).toBe(502)
    const data = (await res.json()) as { error: string }
    expect(data.error).toContain('socket hang up')
  })

  it('上游非 2xx 返回 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 429 })))
    const res = await handler(post({ image: 'aGk=' }, withAuth({ 'x-forwarded-for': '2.2.2.3' })))
    expect(res.status).toBe(502)
  })

  it('成功路径返回归一化 items', async () => {
    const raw = '[{"name":"香辣味 16g×8袋","price":4.94,"quantity":16,"unit":"g","packs":8,"confidence":0.95}]'
    vi.stubGlobal('fetch', vi.fn(async () => qwenOk(raw)))
    const headers = withAuth({ 'x-forwarded-for': '1.1.1.1' })
    const res = await handler(post({ image: 'aGk=', prompt: 'p' }, headers))
    expect(res.status).toBe(200)
    const data = (await res.json()) as { items: unknown[] }
    expect(data.items).toHaveLength(1)
  })
})

describe('纯函数', () => {
  it('extractToken 支持 Bearer 与自定义头', () => {
    expect(extractToken(post({}, { Authorization: 'Bearer abc' }))).toBe('abc')
    expect(extractToken(post({}, { 'x-recognize-token': 'xyz' }))).toBe('xyz')
    expect(extractToken(post({}))).toBe('')
  })

  it('isOriginAllowed 未配置时放行，配置后按主机匹配', () => {
    expect(isOriginAllowed(post({}), [])).toBe(true)
    expect(isOriginAllowed(post({}, { Origin: 'https://a.example.com' }), ['a.example.com'])).toBe(true)
    expect(isOriginAllowed(post({}, { Origin: 'https://b.example.com' }), ['a.example.com'])).toBe(false)
  })

  it('parseItems 剥离代码块并过滤脏数据', () => {
    const items = parseItems('```json\n[{"name":"A","price":1},{"name":"","price":2},{"name":"C","price":0}]\n```')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ name: 'A', price: 1, confidence: 0.8 })
  })

  it('parseItems 非法输入返回空数组', () => {
    expect(parseItems('not json')).toEqual([])
  })
})
