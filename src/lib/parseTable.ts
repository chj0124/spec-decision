import type { RecognizedSku, RecognizedDim } from './recognize'
import { parseSpec } from './engine'

/**
 * 解析剪贴板里的表格文本/HTML，转成可导入的 RecognizedSku[]。
 *
 * 支持来源：
 *  - Excel / WPS / Numbers 复制（TSV：tab 分列，换行分行）
 *  - 电商页面（淘宝/京东/拼多多）复制的 HTML 表格
 *  - Markdown 表格
 *  - 其他任意 tab/多空格/逗号分隔的文本
 *
 * 列检测策略：
 *  1. 优先按表头关键词匹配（价/规格/数量/单位/含量）
 *  2. 无表头或匹配失败时，按列内容启发式判断（货币符号、纯整数、单位词等）
 *  3. 规格名里的 "38g×20袋" 会自动拆出 quantity/unit/packs
 *  4. 剩余的数值/文本列作为参数维度
 */

export interface ParseTableResult {
  items: RecognizedSku[]
  dims?: RecognizedDim[]
  note?: string
}

/** 已知单位词（用于识别"单位列"或从规格名解析单位） */
const KNOWN_UNITS = new Set([
  'g', 'kg', 'mg', '克', '千克', '斤', '两', '磅', 'lb', 'oz', '盎司',
  'ml', 'L', 'l', '毫升', '升', 'gal', '加仑',
  'cm', 'm', 'mm', '厘米', '米', '毫米', '寸', '尺', '英寸', 'in',
  '个', '件', '包', '袋', '盒', '箱', '瓶', '罐', '份', '只', '支', '条', '块', '片', '张', '本', '卷', '对', '套', '组',
])

/** 价格列关键词 */
const PRICE_HEADERS = /^(价|价格|售价|单价|金额|元|钱|现价|优惠价|到手价)/
/** 规格名列关键词 */
const NAME_HEADERS = /^(规格|型号|名称|商品|品名|描述|SKU|款式|版本|产品|商品名|规格型号)/
/** 件数列关键词 */
const PACKS_HEADERS = /^(件数|数量|包数|份数|箱数|盒数|袋数|瓶数|个数|套数)/
/** 单位列关键词 */
const UNIT_HEADERS = /^(单位|计量)/
/** 含量列关键词 */
const QTY_HEADERS = /^(含量|重量|容量|体积|长度|净含量|规格含量|单件含量)/

/** 价格单元格：¥89.9 / ￥89.90 / $12 / 89.9元 / 89.9 */
const PRICE_CELL = /^[¥￥$]?\s*\d+(?:\.\d+)?\s*元?$/
/** 纯整数单元格（可能是件数） */
const INT_CELL = /^\d+$/
/** 带货币符号前缀 */
const CURRENCY_PREFIX = /^[¥￥$]/

/** 从字符串里提取数值（"¥89.90" → 89.9，"12元" → 12） */
function toNumber(s: string): number {
  const m = s.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  return m ? parseFloat(m[0]) : 0
}

/** 解析 HTML <table> 为二维数组 */
function parseHtmlTable(html: string): string[][] {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const table = doc.querySelector('table')
    if (!table) return []
    const rows: string[][] = []
    table.querySelectorAll('tr').forEach((tr) => {
      const cells: string[] = []
      tr.querySelectorAll('td, th').forEach((cell) => {
        cells.push(cell.textContent?.replace(/\s+/g, ' ').trim() ?? '')
      })
      // 跳过全空行
      if (cells.some((c) => c)) rows.push(cells)
    })
    return rows
  } catch {
    return []
  }
}

/** 解析纯文本表格为二维数组（TSV > 逗号 > 多空格） */
function parseTextTable(text: string): string[][] {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\r/g, '')).filter((l) => l.trim())
  if (lines.length === 0) return []
  // 判断分隔符：tab 优先（Excel 复制默认），其次逗号，最后多空格
  const hasTab = lines[0].includes('\t')
  const hasComma = !hasTab && lines[0].includes(',')
  return lines.map((line) => {
    if (hasTab) return line.split('\t').map((c) => c.trim())
    if (hasComma) return line.split(',').map((c) => c.trim())
    // 多空格分隔（Markdown 表格 | a | b | 也走这里，先去 | 再分）
    const cleaned = line.replace(/^\s*\|?\s*\|?\s*$/, '').replace(/\|/g, ' ')
    return cleaned.split(/\s{2,}|\t/).map((c) => c.trim()).filter(Boolean)
  })
}

/** 列类型枚举 */
type ColKind = 'price' | 'name' | 'packs' | 'unit' | 'quantity' | 'dim' | 'ignore'

interface ColInfo {
  kind: ColKind
  /** 参数维度名（kind='dim' 时有效） */
  dimLabel?: string
}

/**
 * 检测每列的类型：先表头关键词，后内容启发式
 */
function detectColumns(header: string[] | null, dataRows: string[][]): ColInfo[] {
  const colCount = Math.max(...dataRows.map((r) => r.length), header?.length ?? 0)
  const cols: ColInfo[] = []
  // 各列的所有取值（用于启发式判断）
  const colValues: string[][] = Array.from({ length: colCount }, () => [])
  for (const row of dataRows) {
    for (let i = 0; i < colCount; i++) {
      colValues[i].push(row[i] ?? '')
    }
  }

  // 第一遍：表头关键词
  if (header) {
    for (let i = 0; i < colCount; i++) {
      const h = (header[i] ?? '').trim()
      if (!h) { cols.push({ kind: 'ignore' }); continue }
      if (PRICE_HEADERS.test(h)) { cols.push({ kind: 'price' }); continue }
      if (NAME_HEADERS.test(h)) { cols.push({ kind: 'name' }); continue }
      if (PACKS_HEADERS.test(h)) { cols.push({ kind: 'packs' }); continue }
      if (UNIT_HEADERS.test(h)) { cols.push({ kind: 'unit' }); continue }
      if (QTY_HEADERS.test(h)) { cols.push({ kind: 'quantity' }); continue }
      cols.push({ kind: 'dim', dimLabel: h }) // 待定，可能是参数维度
    }
  } else {
    // 无表头：全部待定，用内容判断
    for (let i = 0; i < colCount; i++) cols.push({ kind: 'dim' })
  }

  // 第二遍：内容启发式（只处理 kind='dim' 的列，已识别的不覆盖）
  // 统计已有匹配
  let hasPrice = cols.some((c) => c.kind === 'price')
  let hasName = cols.some((c) => c.kind === 'name')
  for (let i = 0; i < colCount; i++) {
    if (cols[i].kind !== 'dim') continue
    const vals = colValues[i].filter(Boolean)
    if (vals.length === 0) { cols[i] = { kind: 'ignore' }; continue }
    const allPrice = vals.every((v) => PRICE_CELL.test(v))
    const allInt = vals.every((v) => INT_CELL.test(v)) && vals.every((v) => {
      const n = parseInt(v, 10)
      return n >= 1 && n <= 9999
    })
    const allUnit = vals.every((v) => KNOWN_UNITS.has(v))

    if (!hasPrice && allPrice) { cols[i] = { kind: 'price' }; hasPrice = true; continue }
    if (allUnit) { cols[i] = { kind: 'unit' }; continue }
    if (!hasName && allInt && vals.length >= 2) {
      // 纯整数列可能是件数也可能是含量，先标记为 packs，后面如果没有 name 会回退
      cols[i] = { kind: 'packs' }
      continue
    }
  }

  // 第三遍：如果还没有 name 列，取第一个非数值、非单位的文本列作为 name
  if (!hasName) {
    for (let i = 0; i < colCount; i++) {
      if (cols[i].kind !== 'dim') continue
      const vals = colValues[i].filter(Boolean)
      if (vals.length === 0) continue
      // 文本列（非纯数字、非单位词）→ 视为规格名
      const isText = vals.some((v) => !PRICE_CELL.test(v) && !KNOWN_UNITS.has(v))
      if (isText) {
        cols[i] = { kind: 'name' }
        hasName = true
        break
      }
    }
  }

  // 第四遍：如果还没有 price 列，取第一个纯数字列
  if (!hasPrice) {
    for (let i = 0; i < colCount; i++) {
      if (cols[i].kind !== 'dim') continue
      const vals = colValues[i].filter(Boolean)
      if (vals.length === 0) continue
      if (vals.every((v) => PRICE_CELL.test(v) || v === '')) {
        cols[i] = { kind: 'price' }
        hasPrice = true
        break
      }
    }
  }

  return cols
}

/** 判断某行是否是表头（含关键词且无价格数值） */
function isHeaderRow(row: string[]): boolean {
  const text = row.join(' ')
  if (!text) return false
  // 含表头关键词，且整行没有"真实价格数值"（¥89.9 这种带符号的视为数据）
  const hasKeyword = /^(价|规格|型号|名称|商品|品名|含量|重量|容量|单位|件数|数量|包数)/m.test(
    row.map((c) => c.trim()).filter(Boolean).join('|'),
  )
  if (!hasKeyword) return false
  // 但如果同一行全是带货币符号的数值，则不是表头
  const dataLike = row.some((c) => CURRENCY_PREFIX.test(c.trim()))
  return !dataLike
}

/** 从规格名解析 quantity/unit/packs，补全缺失字段 */
function buildSkuFromName(name: string): Partial<RecognizedSku> {
  const parts = parseSpec(name)
  return {
    name,
    quantity: parts.quantity ?? 1,
    unit: parts.unit || '个',
    packs: parts.packs ?? 1,
  }
}

/**
 * 主入口：解析剪贴板内容。
 * 优先用 HTML（电商页面带格式），失败回退纯文本。
 */
export function parseClipboardTable(text: string, html?: string): ParseTableResult | null {
  let rows: string[][] = []
  if (html) rows = parseHtmlTable(html)
  if (rows.length < 2 && text) rows = parseTextTable(text)
  if (rows.length < 2) return null

  // 分离表头
  let header: string[] | null = null
  let dataRows = rows
  if (isHeaderRow(rows[0])) {
    header = rows[0]
    dataRows = rows.slice(1)
  }
  if (dataRows.length === 0) return null

  const colInfos = detectColumns(header, dataRows)
  const hasPrice = colInfos.some((c) => c.kind === 'price')
  const hasName = colInfos.some((c) => c.kind === 'name')
  if (!hasPrice) {
    return { items: [], note: '没识别到价格列，请确认表格包含价格信息后重试' }
  }
  if (!hasName) {
    return { items: [], note: '没识别到规格/名称列，请确认表格包含商品名称后重试' }
  }

  // 构建 SKU
  const items: RecognizedSku[] = dataRows.map((row) => {
    let name = ''
    let price = 0
    let quantity: number | undefined
    let unit: string | undefined
    let packs: number | undefined
    const params: Record<string, string | number> = {}

    for (let i = 0; i < colInfos.length; i++) {
      const info = colInfos[i]
      const val = (row[i] ?? '').trim()
      if (!val) continue
      switch (info.kind) {
        case 'price':
          if (price === 0) price = toNumber(val)
          break
        case 'name':
          if (!name) name = val
          break
        case 'quantity':
          if (quantity === undefined) quantity = toNumber(val)
          break
        case 'unit':
          if (!unit) unit = val
          break
        case 'packs':
          if (packs === undefined) packs = toNumber(val) || 1
          break
        case 'dim':
          if (info.dimLabel) {
            const n = Number(val)
            params[info.dimLabel] = !isNaN(n) && val !== '' ? n : val
          }
          break
      }
    }

    // 规格名解析补全 quantity/unit/packs
    const parsed = buildSkuFromName(name || '未命名')
    if (quantity === undefined) quantity = parsed.quantity
    if (!unit) unit = parsed.unit
    if (packs === undefined) packs = parsed.packs

    return {
      name: name || '未命名',
      price,
      quantity: quantity ?? 1,
      unit: unit || '个',
      packs: packs ?? 1,
      confidence: 1,
      ...(Object.keys(params).length > 0 ? { params } : {}),
    }
  })

  // 收集参数维度（kind='dim' 的列）
  const dims: RecognizedDim[] = []
  for (const info of colInfos) {
    if (info.kind === 'dim' && info.dimLabel) {
      // 判断维度类型：全数值 → higher-better，否则 text
      const allNumeric = items.every((it) => {
        const v = it.params?.[info.dimLabel!]
        return v === undefined || typeof v === 'number'
      })
      dims.push({ label: info.dimLabel, type: allNumeric ? 'higher-better' : 'text' })
    }
  }

  return {
    items,
    dims: dims.length > 0 ? dims : undefined,
    note: `从粘贴的表格解析出 ${items.length} 行${dims.length > 0 ? `，识别到 ${dims.length} 个参数维度` : ''}`,
  }
}
