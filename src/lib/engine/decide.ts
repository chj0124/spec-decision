import type { DecisionConfig, DecisionResult, Sku } from '../types'
import {
  buildReasons,
  buildWarnings,
  computeSku,
  marginAnalysis,
  scoreItems,
} from './scoring'
import { clusterItems, rankByPreference } from './clusters'

/** 主入口：输入原始 SKU 列表 + 决策配置，输出完整决策结果 */
export function decide(skus: Sku[], config: DecisionConfig): DecisionResult {
  const valid = skus.filter((s) => s.price > 0 && s.quantity > 0 && s.packs > 0)
  const computed = valid.map(computeSku)
  const scored = scoreItems(computed, config)
  const sorted = rankByPreference(scored, config.preference, config.budget)

  const best = sorted[0] ?? null
  const baseline =
    sorted.length > 0
      ? [...sorted].sort((a, b) => a.unitPrice - b.unitPrice)[0]
      : null

  // 预算偏好：超预算的规格被挡在 items 之外。这里把"被挡掉的是哪些"原样带上，
  // 报告页才能说明"谁被排除了、各超了多少"——只给计数会让它们无声消失。
  // 按总价升序：最接近预算的排前面，这些才是用户最可能想回头看一眼的。
  const budgetExcludedItems =
    config.preference === 'budget' && typeof config.budget === 'number' && config.budget > 0
      ? scored
          .filter((i) => i.price > config.budget!)
          .sort((a, b) => a.price - b.price)
      : []

  const clusters = clusterItems(sorted)
  // 存在「同定价因子、多成员」的簇 → 说明有口味/颜色等干扰维度需要折叠
  const hasVariants = clusters.some((c) => c.members.length > 1)

  return {
    items: sorted,
    best,
    baseline,
    margins: marginAnalysis(sorted),
    warnings: buildWarnings(sorted),
    reasons: best ? buildReasons(best, sorted) : [],
    clusters,
    hasVariants,
    budgetExcludedItems,
  }
}
