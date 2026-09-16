import type { DecisionResult, DecisionConfig } from '../types'
import {
  fmt, isStale, STALE_DAYS, displayUnit, displayQuantity, displayUnitPrice,
} from '../engine'

/** 生成纯文本决策摘要（复制到剪贴板 / 导出用） */
export function buildSummaryText(result: DecisionResult, config: DecisionConfig): string {
  const { best, items, reasons, warnings, margins, budgetExcludedItems } = result
  if (!best) return ''
  const lines: string[] = []
  lines.push('【规格决策摘要】')
  if (config.category) lines.push(`商品类型：${config.category}`)
  lines.push(`生成时间：${new Date().toLocaleString('zh-CN')}`)
  lines.push('')
  lines.push(`★ 最划算：${best.name}`)
  lines.push(
    `  总价 ${fmt.yuan(best.price)} · 总量 ${fmt.num(displayQuantity(best.totalQuantity, best.unit))}${displayUnit(best.unit)}` +
    ` · 每${displayUnit(best.unit)} ${fmt.priceUnit(displayUnitPrice(best.unitPrice, best.unit))} · 综合得分 ${best.score.toFixed(1)}`,
  )
  // 摘要会被粘贴到别处流转，脱离页面后就看不出数据有多旧了，所以把新鲜度写进正文
  const priceAt = best.priceHistory?.[best.priceHistory.length - 1]?.t
  if (priceAt) {
    lines.push(
      `  价格记录：${fmt.ago(priceAt)}` +
      (isStale(priceAt) ? `（已超过 ${STALE_DAYS} 天未更新，结论可能过期）` : ''),
    )
  }
  if (reasons.length > 0) {
    lines.push('')
    lines.push('推荐理由：')
    reasons.forEach((r, i) => lines.push(`  ${i + 1}. ${r}`))
  }
  lines.push('')
  lines.push(`完整排名（前 5 / 共 ${items.length} 项）：`)
  items.slice(0, 5).forEach((it) => {
    lines.push(`  ${it.rank}. ${it.name} — 每${displayUnit(it.unit)} ${fmt.priceUnit(displayUnitPrice(it.unitPrice, it.unit))}（总价 ${fmt.yuan(it.price)}）`)
  })
  // 被预算筛掉的规格也要写进摘要：粘贴出去后更要能自查"是我漏填了还是被规则排除了"
  const budget = config.budget
  if (config.preference === 'budget' && typeof budget === 'number' && budgetExcludedItems.length > 0) {
    lines.push('')
    lines.push(`因超预算未纳入比较（预算 ${fmt.yuan(budget)}，按超出金额从少到多）：`)
    budgetExcludedItems.forEach((it) => {
      lines.push(`  · ${it.name} — 总价 ${fmt.yuan(it.price)}，超 ${fmt.yuan(it.price - budget)}`)
    })
  }
  if (margins.length > 0) {
    lines.push('')
    lines.push('边际效益：')
    margins.forEach((m) => lines.push(`  · ${m.verdict}`))
  }
  if (warnings.length > 0) {
    lines.push('')
    lines.push('避坑提示：')
    warnings.forEach((w) => lines.push(`  · ${w}`))
  }
  lines.push('')
  lines.push('— 由「规格决策台」生成')
  return lines.join('\n')
}
