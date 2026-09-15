import type { DecisionConfig, DecisionResult, Sku } from '../types'
import {
  anchorHigherBetter,
  anchorLabelOf,
  anchorOf,
  buildReasons,
  buildWarnings,
  compareAnchorDesc,
  computeSku,
  marginAnalysis,
  scoreItems,
} from './scoring'
import { clusterItems, rankByPreference } from './clusters'

/**
 * 主入口：输入原始 SKU 列表 + 决策配置，输出完整决策结果。
 *
 * 计价模式（config.mode）：
 * - per-unit（默认）   消耗品：按每单位量比价，边际效益按包装档位逐级分析
 * - per-feature        耐用品：按每元性能（主参数÷总价）比价；
 *                      耐用品没有"大包装升档"概念，边际效益分析跳过（返回空数组）
 */
export function decide(skus: Sku[], config: DecisionConfig): DecisionResult {
  const valid = skus.filter((s) => s.price > 0 && s.quantity > 0 && s.packs > 0)
  const computed = valid.map(computeSku)
  const scored = scoreItems(computed, config)
  const perFeature = anchorHigherBetter(config)
  const ranked = rankByPreference(scored, config.preference, config.budget, config)

  // 填充锚点展示字段，下游 UI（冠军卡/表格/散点图）只消费这个抽象，不关心模式
  const sorted = ranked.map((i) => ({
    ...i,
    anchorValue: anchorOf(i, config) ?? undefined,
    anchorLabel: anchorLabelOf(config, i.unit),
    anchorHigherBetter: perFeature,
  }))

  const best = sorted[0] ?? null
  // 性价比锚点基准：per-unit 取单价最低者；per-feature 取每元性能最高者
  const baseline =
    sorted.length > 0
      ? perFeature
        ? [...sorted].sort(compareAnchorDesc(config))[0]
        : [...sorted].sort((a, b) => a.unitPrice - b.unitPrice)[0]
      : null

  // 预算偏好：统计被"超预算"过滤掉的规格数，供报告页区分"没数据"与"预算内无匹配"
  const budgetExcluded =
    config.preference === 'budget' && typeof config.budget === 'number' && config.budget > 0
      ? scored.filter((i) => i.price > config.budget!).length
      : 0

  const clusters = clusterItems(sorted)
  // 存在「同定价因子、多成员」的簇 → 说明有口味/颜色等干扰维度需要折叠
  const hasVariants = clusters.some((c) => c.members.length > 1)

  return {
    items: sorted,
    best,
    baseline,
    margins: perFeature ? [] : marginAnalysis(sorted),
    warnings: buildWarnings(sorted, config),
    reasons: best ? buildReasons(best, sorted, config) : [],
    clusters,
    hasVariants,
    budgetExcluded,
  }
}
