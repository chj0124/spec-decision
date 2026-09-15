/** 数字四舍五入到指定小数位（默认 4 位），避免浮点误差扩散到展示层 */
export const round = (n: number, d = 4) => {
  const p = Math.pow(10, d)
  return Math.round(n * p) / p
}

/** 生成本地唯一 id（仅用于行标识与列表 key，不参与持久化身份校验） */
export const uid = () => Math.random().toString(36).slice(2, 9)

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
}
