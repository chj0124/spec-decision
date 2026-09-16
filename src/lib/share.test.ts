import { describe, it, expect, afterEach, vi } from 'vitest'
import { encodeShare, decodeShare, buildShareUrl, readShareToken, clearShareHash } from './share'
import type { ShareData } from './share'
import type { Sku, DecisionConfig } from './types'

const sku = (over: Partial<Sku> = {}): Sku => ({
  id: 'a',
  name: '测试规格',
  price: 9.9,
  quantity: 100,
  unit: 'g',
  packs: 1,
  ...over,
})

const config: DecisionConfig = { dims: [], priceWeight: 50, preference: 'value' }

const data = (over: Partial<ShareData> = {}): ShareData => ({ skus: [sku()], config, ...over })

/** 手工构造一个 plain 前缀（'0'）的 token，用于喂非法结构 */
const plainToken = (obj: unknown): string =>
  '0' + btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('encodeShare / decodeShare 往返', () => {
  it('往返后清单与配置保持一致', async () => {
    const token = await encodeShare(
      data({ skus: [sku({ name: 'A' }), sku({ id: 'b', name: 'B', price: 12 })] }),
    )

    const decoded = await decodeShare(token)

    expect(decoded).not.toBeNull()
    expect(decoded?.skus.map((s) => s.name)).toEqual(['A', 'B'])
    expect(decoded?.config).toEqual(config)
  })

  it('压缩可用时走 deflate 前缀', async () => {
    expect((await encodeShare(data()))[0]).toBe('1')
  })

  it('分享剥掉 priceHistory，避免把 URL 撑爆', async () => {
    const token = await encodeShare(data({ skus: [sku({ priceHistory: [{ t: 1, price: 9.9 }] })] }))

    const decoded = await decodeShare(token)

    expect(decoded?.skus[0].priceHistory).toBeUndefined()
  })

  it('无压缩能力时降级为 plain 前缀，plain 路径仍可解码', async () => {
    vi.stubGlobal('CompressionStream', undefined)
    vi.stubGlobal('DecompressionStream', undefined)

    const token = await encodeShare(data({ skus: [sku({ name: '降级' })] }))

    expect(token[0]).toBe('0')
    expect((await decodeShare(token))?.skus[0].name).toBe('降级')
  })
})

describe('decodeShare 拒绝非法 / 损坏输入（不抛异常）', () => {
  it('只有前缀、没有 body → null', async () => {
    expect(await decodeShare('1')).toBeNull()
  })

  it('未知前缀 → null', async () => {
    expect(await decodeShare('9AAAA')).toBeNull()
  })

  it('deflate 前缀但内容不是有效压缩流 → null', async () => {
    const bogus = '1' + btoa('this-is-not-deflate').replace(/=+$/, '')

    expect(await decodeShare(bogus)).toBeNull()
  })

  it('合法 JSON 但缺少 config.dims → null', async () => {
    expect(await decodeShare(plainToken({ v: 1, skus: [] }))).toBeNull()
  })
})

describe('URL hash 读写', () => {
  const replaceState = vi.fn()

  const stubWindow = (hash = '') => {
    vi.stubGlobal('window', {
      location: { origin: 'https://app.test', pathname: '/', search: '', hash },
      history: { replaceState },
    })
  }

  it('buildShareUrl 拼成 #r=<token>', () => {
    stubWindow()
    expect(buildShareUrl('1ABC')).toBe('https://app.test/#r=1ABC')
  })

  it('readShareToken 从 hash 中取出 token', () => {
    stubWindow('#r=1XYZ')
    expect(readShareToken()).toBe('1XYZ')
  })

  it('无 hash 时 readShareToken 返回 null', () => {
    stubWindow()
    expect(readShareToken()).toBeNull()
  })

  it('clearShareHash 清掉 hash 并调用 history.replaceState', () => {
    stubWindow('#r=1XYZ')

    clearShareHash()

    expect(replaceState).toHaveBeenCalledWith(null, '', '/')
  })
})
