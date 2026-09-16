import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  report,
  getEvents,
  clearEvents,
  setSink,
  onTelemetry,
  appVersion,
  installGlobalErrorHandlers,
} from './telemetry'

beforeEach(() => {
  clearEvents()
  setSink(null)
  // report('error'|'warn') 会打 console：测试里静音，避免污染输出
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('telemetry 事件结构', () => {
  it('report 返回带 app/version/level/event/meta/at 的事件', () => {
    const evt = report('info', 'share.action', { kind: 'copy', ok: true })
    expect(evt.app).toBe('spec-decision')
    expect(evt.level).toBe('info')
    expect(evt.event).toBe('share.action')
    expect(evt.meta).toEqual({ kind: 'copy', ok: true })
    expect(typeof evt.at).toBe('number')
    expect(typeof evt.version).toBe('string')
  })

  it('单测（node）无构建期版本常量时降级为 dev', () => {
    expect(appVersion()).toBe('dev')
  })
})

describe('脱敏：白名单只放行 schema 登记的字段', () => {
  it('未登记的敏感字段（apiKey / price / params / skus / messages）一律丢弃', () => {
    const evt = report('error', 'app.error', {
      source: 'window.onerror',
      reason: 'boom',
      apiKey: 'sk-abcdef1234567890',
      baseUrl: 'https://api.deepseek.com/v1',
      price: 9.9,
      params: { a: 1 },
      skus: [{ id: 'x' }],
      messages: [{ role: 'user', content: 'secret' }],
    })
    expect(evt.meta).toEqual({ source: 'window.onerror', reason: 'boom' })
    const keys = Object.keys(evt.meta)
    for (const forbidden of ['apiKey', 'baseUrl', 'price', 'params', 'skus', 'messages']) {
      expect(keys).not.toContain(forbidden)
    }
  })

  it('未登记的事件：meta 全丢，只保留事件名', () => {
    const evt = report('info', 'not.registered', { anything: 1, price: 3 })
    expect(evt.event).toBe('not.registered')
    expect(evt.meta).toEqual({})
  })
})

describe('脱敏：值级擦除', () => {
  it('图片 dataURL 被整体替换为 [image-redacted]', () => {
    const evt = report('error', 'app.error', {
      reason: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
    })
    expect(evt.meta.reason).toBe('[image-redacted]')
  })

  it('密钥样式串被抹除（sk- / Bearer / 长 base64 块）', () => {
    expect(report('error', 'app.error', { reason: 'token sk-abcdef123456 leak' }).meta.reason)
      .toBe('token sk-*** leak')
    expect(report('error', 'app.error', { reason: 'Authorization: Bearer abc.def-ghi_jkl' }).meta.reason)
      .toBe('Authorization: Bearer ***')
    expect(report('error', 'app.error', { reason: 'A'.repeat(40) }).meta.reason).toBe('***')
  })

  it('超长字符串截断到 200 字符', () => {
    const evt = report('error', 'app.error', { reason: 'boom '.repeat(100) })
    expect((evt.meta.reason as string).length).toBe(200)
  })

  it('对象 / 数组等非标量值不展开，替换为 [omitted]', () => {
    const evt = report('error', 'app.error', { reason: { nested: 'secret' } as unknown as string })
    expect(evt.meta.reason).toBe('[omitted]')
  })
})

describe('环形缓冲与旁路', () => {
  it('内存缓冲只保留最近 RING_SIZE(100) 条', () => {
    for (let i = 0; i < 120; i++) report('info', 'share.action', { kind: String(i) })
    const events = getEvents()
    expect(events.length).toBe(100)
    expect(events[events.length - 1].meta.kind).toBe('119')
    expect(events[0].meta.kind).toBe('20')
  })

  it('setSink 可旁接外部平台，onTelemetry 可订阅事件流', () => {
    const sinkCalls: string[] = []
    const seen: string[] = []
    setSink((e) => sinkCalls.push(e.event))
    const off = onTelemetry((e) => seen.push(e.event))
    report('info', 'undo.action', { kind: 'delete', ok: true })
    off()
    report('info', 'undo.action', { kind: 'import', ok: true })
    expect(sinkCalls).toEqual(['undo.action', 'undo.action'])
    expect(seen).toEqual(['undo.action'])
  })

  it('接入方（sink / 订阅者）抛错不影响业务，report 不抛', () => {
    setSink(() => {
      throw new Error('sink down')
    })
    const off = onTelemetry(() => {
      throw new Error('listener down')
    })
    expect(() => report('info', 'share.action', { kind: 'copy' })).not.toThrow()
    off()
  })

  it('meta 含循环引用等异常值也不抛错', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => report('error', 'app.error', { reason: circular as unknown as string })).not.toThrow()
  })
})

describe('平台可见性', () => {
  it('error 级别打到 console.error，便于平台/浏览器捕获', () => {
    report('error', 'app.error', { source: 'window.onerror', reason: 'boom' })
    expect(console.error).toHaveBeenCalledTimes(1)
    const [line] = vi.mocked(console.error).mock.calls[0]
    expect(String(line)).toContain('app.error')
  })

  it('installGlobalErrorHandlers 在非浏览器环境为安全 no-op，可重复调用', () => {
    expect(() => {
      installGlobalErrorHandlers()
      installGlobalErrorHandlers()
    }).not.toThrow()
  })
})
