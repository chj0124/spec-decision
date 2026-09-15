/** 数字四舍五入到指定小数位（默认 4 位），避免浮点误差扩散到展示层 */
export const round = (n: number, d = 4) => {
  const p = Math.pow(10, d)
  return Math.round(n * p) / p
}

/** 生成本地唯一 id（仅用于行标识与列表 key，不参与持久化身份校验） */
export const uid = () => Math.random().toString(36).slice(2, 9)

/** 数据新鲜度门槛：价格记录超过这么多天没更新，结论就该打问号 */
export const STALE_DAYS = 30

/** 时间戳是否已过期（用于给"可能过期的结论"加显式标记） */
export const isStale = (ts: number | undefined, now = Date.now()): boolean =>
  typeof ts === 'number' && Number.isFinite(ts) && ts > 0 && now - ts > STALE_DAYS * 86_400_000

/**
 * 报告区的「展示单位」换算。
 *
 * 容量类商品的基准单位是 ml（归一化后用于跨规格比价），但"每 ml ¥0.0032"这种数字
 * 读不出量级、还挤在小数点后，用户无法凭直觉比较。报告与结论文案里统一换成
 * "每 L ¥3.23"，录入表仍保留 ml（比价需要统一基准），只有展示层做这层换算。
 *
 * factor = 1 个展示单位等于多少个基准单位（L = 1000 ml）。
 */
const DISPLAY_UNIT_MAP: Record<string, { unit: string; factor: number }> = {
  ml: { unit: 'L', factor: 1000 },
}

/** 展示单位名（ml → L），非容量单位原样返回 */
export const displayUnit = (unit: string): string =>
  DISPLAY_UNIT_MAP[unit]?.unit ?? unit

/** 把基准单位的总量换算成展示单位总量（ml → L 需 ÷1000） */
export const displayQuantity = (quantity: number, unit: string): number => {
  const factor = DISPLAY_UNIT_MAP[unit]?.factor
  return factor ? round(quantity / factor, 4) : quantity
}

/** 把「每基准单位价格」换算成「每展示单位价格」（每 ml 价 ×1000 = 每 L 价） */
export const displayUnitPrice = (unitPrice: number, unit: string): number => {
  const factor = DISPLAY_UNIT_MAP[unit]?.factor
  return factor ? round(unitPrice * factor, 4) : unitPrice
}

/** 数字格式化 */
export const fmt = {
  yuan: (n: number) => `¥${n.toFixed(2)}`,
  // 单价：根据数量级自适应精度，避免极小单价（如 ¥0.000041/g）显示成 ¥0.0000
  price4: (n: number) => {
    if (n <= 0) return '¥0'
    if (n >= 0.01) return `¥${n.toFixed(4)}`
    // 极小值：保留足够多的有效位
    return `¥${n.toPrecision(2)}`
  },
  /**
   * 单价友好显示：根据数值大小自适应精度，避免一串小数零或多余小数位。
   * - < 0.1 元：改用"分"表达，如 0.0257 → "2.57分"
   * - 0.1 ~ 1 元：保留4位小数，如 0.5234 → "¥0.5234"
   * - ≥ 1 元：保留2位小数，如 89.9 → "¥89.90"
   */
  priceUnit: (n: number) => {
    if (n <= 0) return '0分'
    if (n < 0.1) return `${(n * 100).toFixed(2)}分`
    if (n < 1) return `¥${n.toFixed(4)}`
    return `¥${n.toFixed(2)}`
  },
  num: (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2)),
  pct: (n: number) => `${n.toFixed(1)}%`,
  /**
   * 相对时间：把时间戳说成"多久以前"，让"这条数据有多新"一眼可见。
   * 超过 30 天改用绝对日期，避免"128 天前"这种读不出具体时间点的说法。
   */
  ago: (ts: number, now = Date.now()) => {
    if (!Number.isFinite(ts) || ts <= 0) return '时间未知'
    const diff = now - ts
    if (diff < 60_000) return '刚刚'
    const min = Math.floor(diff / 60_000)
    if (min < 60) return `${min} 分钟前`
    const hour = Math.floor(min / 60)
    if (hour < 24) return `${hour} 小时前`
    const day = Math.floor(hour / 24)
    if (day < 30) return `${day} 天前`
    const d = new Date(ts)
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
  },
}
