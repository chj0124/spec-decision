import type { Sku, DecisionConfig } from './types'

/**
 * 报告分享：把「清单 + 配置」压进 URL hash，实现纯前端只读分享。
 *
 * 编码格式：`#r=<前缀><base64url>`
 *  - 前缀 `1`：内容经 deflate-raw 压缩（现代浏览器原生 CompressionStream）
 *  - 前缀 `0`：压缩不可用时的降级 —— 直接 base64url(JSON)
 * 打开带该 hash 的链接即进入只读分享视图，可一键导入到自己的清单。
 */

const HASH_KEY = 'r'
const PREFIX_DEFLATE = '1'
const PREFIX_PLAIN = '0'

export interface ShareData {
  skus: Sku[]
  config: DecisionConfig
}

/* ---------- base64url 编解码（避免 + / = 在 URL 中被转义） ---------- */

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000 // 分块避免超长参数触发 apply 栈溢出
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(s: string): Uint8Array {
  const pad = (4 - (s.length % 4)) % 4
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad)
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/* ---------- 压缩 / 解压（CompressionStream 不可用时返回 null 走降级路径） ---------- */

function supportsCompression(): boolean {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function'
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

/** 经 TransformStream 转换字节流；DOM 类型里 CompressionStream 的 writable 声明为 BufferSource，与 Uint8Array 泛型不兼容，故在边界处断言 */
async function throughStream(
  bytes: Uint8Array,
  transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const stream = streamOf(bytes).pipeThrough(
    transform as unknown as TransformStream<Uint8Array, Uint8Array>,
  )
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (!supportsCompression()) return null
  try {
    return await throughStream(bytes, new CompressionStream('deflate-raw'))
  } catch {
    return null
  }
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (!supportsCompression()) return null
  try {
    return await throughStream(bytes, new DecompressionStream('deflate-raw'))
  } catch {
    return null
  }
}

/* ---------- 对外 API ---------- */

/** 编码为可放进 URL hash 的紧凑 token */
export async function encodeShare(data: ShareData): Promise<string> {
  const json = JSON.stringify({ v: 1, skus: data.skus, config: data.config })
  const raw = new TextEncoder().encode(json)
  const packed = await deflate(raw)
  if (packed) return PREFIX_DEFLATE + bytesToBase64Url(packed)
  return PREFIX_PLAIN + bytesToBase64Url(raw)
}

/** 解码 token；格式非法或内容损坏时返回 null（调用方据此忽略分享链接） */
export async function decodeShare(token: string): Promise<ShareData | null> {
  try {
    const prefix = token[0]
    const body = token.slice(1)
    if (!body) return null

    let bytes = base64UrlToBytes(body)
    if (prefix === PREFIX_DEFLATE) {
      const inflated = await inflate(bytes)
      if (!inflated) return null
      bytes = inflated
    } else if (prefix !== PREFIX_PLAIN) {
      return null
    }

    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
      v?: number
      skus?: Sku[]
      config?: DecisionConfig
    }
    if (!Array.isArray(parsed.skus) || !parsed.config || !Array.isArray(parsed.config.dims)) {
      return null
    }
    return { skus: parsed.skus, config: parsed.config }
  } catch {
    return null
  }
}

/** 拼接完整分享链接（去掉已有 hash，避免叠加） */
export function buildShareUrl(token: string): string {
  const { origin, pathname, search } = window.location
  return `${origin}${pathname}${search}#${HASH_KEY}=${token}`
}

/** 从当前地址读取分享 token；没有则返回 null */
export function readShareToken(): string | null {
  const hash = window.location.hash.replace(/^#/, '')
  if (!hash) return null
  const params = new URLSearchParams(hash)
  return params.get(HASH_KEY)
}

/** 清空地址栏中的分享 hash（进入编辑态时调用，保持 URL 干净） */
export function clearShareHash(): void {
  if (!window.location.hash) return
  window.history.replaceState(null, '', window.location.pathname + window.location.search)
}
