/**
 * 零依赖可观测性（埋点）模块。
 *
 * 设计要点：
 *  1. **接口极简**：只有 `report(level, event, meta)`；默认实现 = 环形缓冲（内存）+ console，
 *     生产可按需通过 `setSink` 旁接到 Sentry / 自建平台，不引入任何三方依赖。
 *  2. **强制脱敏（白名单）**：每个事件只有登记在 `EVENT_SCHEMA` 里的 meta 字段才可能被上报；
 *     未登记事件一律丢弃全部 meta。再叠加 `DENY_KEYS`（apiKey / messages / price / skus …）
 *     与值级擦除（密钥样式串、超长 base64），从根上杜绝"顺手带上业务数据"。
 *  3. **绝不抛错**：埋点失败不能反过来把业务打崩，所有入口 catch 后静默。
 *
 * 这样页面承诺的"数据仅保存在你的浏览器本地"依然成立——埋点里不含任何业务数据。
 */

const APP = 'spec-decision'
const RING_SIZE = 100
const MAX_STRING = 200

export type TelemetryLevel = 'fatal' | 'error' | 'warn' | 'info'

export interface TelemetryEvent {
  app: string
  version: string
  level: TelemetryLevel
  event: string
  meta: Record<string, string | number | boolean | null>
  at: number
}

/**
 * 事件 schema：**白名单**。只有这里列出的 meta 字段才可能被上报。
 * 新增事件时必须在此登记 —— 没登记就只有一个事件名，没有任何 meta。
 */
const EVENT_SCHEMA: Record<string, readonly string[]> = {
  'app.error': ['source', 'reason'],
  'app.rejection': ['source', 'reason'],
  'persist.fail': ['storageKey', 'reason'],
  'persist.recover': ['storageKey'],
  'ai.request': ['kind', 'ok', 'status', 'ms'],
  'ai.config': ['provider', 'enabled', 'hasKey'],
  'unit.normalize': ['unknown', 'matched'],
  'share.action': ['kind', 'ok'],
  'undo.action': ['kind', 'ok'],
}

/**
 * 永远禁止出现在 meta 里的字段名（大小写不敏感）。
 * 白名单是第一道闸，这是第二道兜底：万一某事件误把敏感键写进 schema，也不会泄露。
 */
const DENY_KEYS: ReadonlySet<string> = new Set([
  'apikey', 'api_key', 'authorization', 'auth', 'token', 'secret', 'password',
  'messages', 'message', 'content', 'prompt', 'image', 'imagebase64',
  'base64', 'dataurl', 'url', 'baseurl', 'skus', 'sku', 'params', 'price',
  'prices', 'pricehistory', 'history', 'config', 'name', 'label', 'note',
])

/** 值级脱敏：密钥样式串、Bearer token、超长 base64 块一律抹掉 */
const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/sk-[A-Za-z0-9_-]{6,}/g, 'sk-***'],
  [/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***'],
  [/[A-Za-z0-9+/]{32,}={0,2}/g, '***'],
]

function scrub(text: string): string {
  let out = text
  for (const [re, replacement] of SECRET_PATTERNS) out = out.replace(re, replacement)
  return out
}

/**
 * 把任意值规整为"安全标量"：
 *  - number / boolean / null 直接放行
 *  - string：先识别图片 dataURL，再擦密钥，最后截断
 *  - object / array：一律丢弃（避免嵌套结构里夹带业务数据）
 */
function sanitizeValue(value: unknown): string | number | boolean | null {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (/^data:image\//i.test(value)) return '[image-redacted]'
    return scrub(value).slice(0, MAX_STRING)
  }
  return '[omitted]'
}

/** 按 schema 过滤 + 逐值脱敏；未登记事件返回空对象 */
function sanitizeMeta(event: string, meta: unknown): TelemetryEvent['meta'] {
  const out: TelemetryEvent['meta'] = {}
  const allowed = EVENT_SCHEMA[event]
  if (!allowed || !meta || typeof meta !== 'object') return out
  const src = meta as Record<string, unknown>
  for (const key of allowed) {
    if (DENY_KEYS.has(key.toLowerCase())) continue
    if (!(key in src)) continue
    out[key] = sanitizeValue(src[key])
  }
  return out
}

/** 把任意抛出物转成短文本（不含堆栈），后续仍会走一遍脱敏 */
function describeError(input: unknown): string {
  if (input == null) return 'unknown'
  if (input instanceof Error) return `${input.name}: ${input.message}`
  if (typeof input === 'string') return input
  try {
    return JSON.stringify(input)
  } catch {
    return String(input)
  }
}

/* ---------- 运行时状态（内存环形缓冲，不落盘、不上报业务数据） ---------- */

const ring: TelemetryEvent[] = []
const listeners = new Set<(e: TelemetryEvent) => void>()
let sink: ((e: TelemetryEvent) => void) | null = null
let installed = false

/** 构建期由 vite define 注入；单测（node）里不存在，降级为 dev */
export function appVersion(): string {
  try {
    return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
  } catch {
    return 'dev'
  }
}

/** 主入口：记录一条事件。永不抛错。 */
export function report(
  level: TelemetryLevel,
  event: string,
  meta?: Record<string, unknown>,
): TelemetryEvent {
  const evt: TelemetryEvent = {
    app: APP,
    version: appVersion(),
    level,
    event: String(event).slice(0, 64),
    meta: sanitizeMeta(String(event), meta),
    at: Date.now(),
  }

  ring.push(evt)
  if (ring.length > RING_SIZE) ring.shift()

  // 平台可见性：默认打到 console（浏览器/Node 均可捕获），接入方可用 setSink 旁接。
  try {
    const line = `[telemetry] ${evt.level} ${evt.event}`
    if (level === 'fatal' || level === 'error') console.error(line, evt.meta)
    else if (level === 'warn') console.warn(line, evt.meta)
    else console.info(line, evt.meta)
  } catch {
    /* console 不可用不影响主流程 */
  }

  if (sink) {
    try {
      sink(evt)
    } catch {
      /* 接入方异常不能影响业务 */
    }
  }
  listeners.forEach((fn) => {
    try {
      fn(evt)
    } catch {
      /* ignore */
    }
  })

  return evt
}

/** 旁接外部平台（如 Sentry）；传 null 移除。默认实现无需它即可工作。 */
export function setSink(fn: ((e: TelemetryEvent) => void) | null) {
  sink = fn
}

/** 订阅事件流，返回取消订阅函数 */
export function onTelemetry(fn: (e: TelemetryEvent) => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** 读取内存中的历史事件（最近 RING_SIZE 条），调试 / 单测用 */
export function getEvents(): TelemetryEvent[] {
  return [...ring]
}

/** 清空内存缓冲 */
export function clearEvents() {
  ring.length = 0
}

/**
 * 捕获全局未处理错误：`window.onerror` + `unhandledrejection`。
 * 幂等，可在启动时无条件调用；非浏览器环境（单测 node）自动跳过。
 */
export function installGlobalErrorHandlers() {
  if (installed || typeof window === 'undefined') return
  installed = true

  window.addEventListener('error', (e) => {
    const ev = e as ErrorEvent
    report('error', 'app.error', {
      source: 'window.onerror',
      reason: describeError(ev.error ?? ev.message),
    })
  })

  window.addEventListener('unhandledrejection', (e) => {
    const ev = e as PromiseRejectionEvent
    report('error', 'app.rejection', {
      source: 'unhandledrejection',
      reason: describeError(ev.reason),
    })
  })
}
