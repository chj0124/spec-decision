import type { Sku } from './types'
import { uid, parseSpec, buildSpec, SPEC_PATTERN } from './engine'

/**
 * 极速录入：把「一行一条规格」的文本批量转成 SKU。
 *
 * 为什么需要它：工作台逐格填一行要动 6 个输入框（口味/规格/总价/含量/单位/件数），
 * 但比价的数据源头本来就是文字——商品标题、聊天记录、备忘录里的一行。
 * 让用户先把文字翻译成格子是纯浪费，这里让用户直接把文字贴进来。
 *
 * 支持的行格式（可混排，顺序不限）：
 *   300ml*12瓶*2箱 27.91              规格 + 价格，最省事
 *   券后¥49.7 无糖芬达 500ml*24瓶      整段标题粘贴，自动挑价格与规格
 *   888ml*12                          只有规格，价格记 0 待补
 *
 * 规格里的复合件数会连乘：300ml*12瓶*2箱 → 24 瓶 / 7200ml，
 * 用户不必再心算「12 瓶 2 箱到底是多少瓶」。
 */

export interface QuickEntryItem {
  /** 原始行，用于预览与错误提示 */
  raw: string
  /** 重建出的商品名（统一口味 + 标准规格写法） */
  name: string
  price: number
  quantity: number
  unit: string
  packs: number
  packUnit?: string
  /** 是否可直接转成一行 SKU（必须解析出规格） */
  ok: boolean
  /** ok=false 时的原因，或 ok=true 但价格缺失的提示 */
  note?: string
}

/** 计量单位词（退化规格识别用；长词在前，避免 "m" 抢先匹配 "ml"） */
const MEASURE_UNIT_WORDS = [
  '千克', '公斤', '毫升', '加仑', '盎司', '英寸', '厘米', '毫米',
  'kg', 'mg', 'ml', 'mL', 'ML', 'mm', 'cm', 'g', 'L', 'l', 'm',
  '克', '斤', '两', '升', '米', '寸', '尺',
].join('|')

/**
 * 无件数的退化规格：数字 + 计量单位（如 "888ml"、"200g"）。
 * 必须限定计量单位白名单，否则「券后49.7元」会被误当成 49.7 元的规格。
 */
const BARE_SPEC = new RegExp(`\\d+(?:\\.\\d+)?\\s*(?:${MEASURE_UNIT_WORDS})`)

/** 价格提示：带货币符号/「元」的优先，命中最左的一个（拼多多的券后价写在原价左边） */
const PRICE_HINTS = [/[¥￥]\s*(\d+(?:\.\d+)?)/, /(\d+(?:\.\d+)?)\s*元/]

/** 在整行文本里定位规格片段 */
function findSpec(line: string): { text: string; start: number; end: number } | null {
  // SPEC_PATTERN 自身不带 g 标志（parseSpec 只需单次匹配），这里克隆一份带 g 的做定位
  const m = new RegExp(SPEC_PATTERN.source, 'g').exec(line)
  if (m && m.index !== undefined) {
    return { text: m[0], start: m.index, end: m.index + m[0].length }
  }
  const d = line.match(BARE_SPEC)
  if (d && d.index !== undefined) {
    return { text: d[0], start: d.index, end: d.index + d[0].length }
  }
  return null
}

/** 在整行文本里取价格，跳过规格片段本身占据的数字 */
function findPrice(line: string, spec: { start: number; end: number } | null): number | null {
  for (const re of PRICE_HINTS) {
    const m = line.match(re)
    if (m) return parseFloat(m[1])
  }
  // 没有货币符号：取规格之外的最后一个数字（价格通常写在行尾）
  const nums = [...line.matchAll(/\d+(?:\.\d+)?/g)].filter(
    (m) =>
      spec === null ||
      m.index === undefined ||
      m.index >= spec.end ||
      m.index + m[0].length <= spec.start,
  )
  if (nums.length === 0) return null
  return parseFloat(nums[nums.length - 1][0])
}

/** 解析单行：规格（必需）+ 价格（可选）+ 统一口味 */
export function parseQuickLine(raw: string, flavor = ''): QuickEntryItem {
  const line = raw.trim()
  const blank: QuickEntryItem = {
    raw: line, name: '', price: 0, quantity: 0, unit: '', packs: 1, ok: false,
  }
  if (!line) return { ...blank, note: '空行' }

  const found = findSpec(line)
  if (!found) return { ...blank, note: '没找到规格，写成「500ml×24瓶」这样就行' }

  const parts = parseSpec(found.text)
  const quantity = parts.quantity ?? 0
  const unit = parts.unit ?? ''
  if (!(quantity > 0) || !unit) {
    return { ...blank, note: '规格缺含量或单位，写成「500ml×24瓶」这样就行' }
  }

  const packs = parts.packs ?? 1
  const specText = buildSpec(quantity, unit, packs, parts.packUnit)
  const price = findPrice(line, found) ?? 0
  const f = flavor.trim()

  return {
    raw: line,
    name: f ? `${f} ${specText}` : specText,
    price,
    quantity,
    unit,
    packs,
    ...(parts.packUnit ? { packUnit: parts.packUnit } : {}),
    ok: true,
    ...(price > 0 ? {} : { note: '没找到价格，先按 0 记，可在表格里补' }),
  }
}

/** 解析多行文本；空行自动跳过 */
export function parseQuickEntry(text: string, flavor = ''): QuickEntryItem[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/\r/g, ''))
    .filter((l) => l.trim())
    .map((l) => parseQuickLine(l, flavor))
}

/** 预览项 → 可入表的 SKU（每次调用生成新的行 id） */
export function quickEntryToSku(item: QuickEntryItem): Sku {
  return {
    id: uid(),
    name: item.name,
    price: item.price,
    quantity: item.quantity,
    unit: item.unit,
    packs: item.packs,
    ...(item.packUnit ? { packUnit: item.packUnit } : {}),
  }
}

/** 该行折算出的每单位价（预览里用来即时看出谁最划算） */
export function quickEntryUnitPrice(item: QuickEntryItem): number {
  const total = item.quantity * Math.max(1, item.packs)
  return total > 0 && item.price > 0 ? item.price / total : 0
}
