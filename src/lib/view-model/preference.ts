import type { ComputedSku, DecisionConfig, Preference } from '../types'

/**
 * 决策偏好的动态提示（显示在偏好按钮组正下方）：说清「当前数据下」各偏好会不会排出不同名次。
 * - 预算优先：行为直观（过滤超预算再按得分排），不需要提示 → null
 * - 没配参数维度，或配了但所有规格取值都相同 → 综合得分退化为价格分，
 *   「性价比优先」与「综合得分优先」排名完全一致（用户点击看不到变化的原因）；
 * - 有参数差异 → 提示当前价格 / 参数的权重侧重。
 */
export function buildPreferenceHint(
  items: ComputedSku[],
  config: DecisionConfig,
  current: Preference,
): string | null {
  if (current === 'budget') return null
  // 有实际区分度的参数维度：至少两个规格在该维度上取值不同
  const effectiveDims = config.dims.filter((d) => {
    const vals = items.map((i) => i.params?.[d.id])
    const present = vals.filter((v) => v !== undefined)
    if (present.length < 1) return false
    return new Set(present.map(String)).size > 1
  })
  if (effectiveDims.length === 0) {
    return '当前清单未配置有差异的参数维度，切换偏好不会改变排名'
  }
  const dimW = effectiveDims.reduce((s, d) => s + Math.max(0, d.weight), 0)
  const priceW = Math.max(0, config.priceWeight)
  const focus =
    priceW > dimW * 1.5 ? '价格主导' : dimW > priceW * 1.5 ? '参数主导' : '价格参数并重'
  return `综合得分 = 价格 ${priceW}% + 参数 ${dimW}% 加权（${focus}）`
}
