import type { ParamType } from '../../lib/types'

/** 表头单元格公共样式：吸附在表格滚动容器顶部，实心底避免内容透出 */
export const TH_BASE =
  'sticky top-0 z-10 bg-brand-soft border-b border-edge px-3 py-3 font-medium text-left text-sm text-slate-500'

export const PARAM_TYPE_LABELS: Record<ParamType, string> = {
  'higher-better': '越大越好',
  'lower-better': '越小越好',
  'boolean': '是/否',
  'text': '评级',
}

/**
 * 权重档位：用语义标签替代 0-100 滑块，用户无需纠结具体数值。
 * 档位值参与 scoreItems 的归一化加权（相对比例生效，绝对值无所谓）。
 */
export const WEIGHT_TIERS = [
  { label: '忽略', value: 0 },
  { label: '参考', value: 5 },
  { label: '一般', value: 15 },
  { label: '重要', value: 30 },
  { label: '关键', value: 50 },
] as const

/** 数值型维度才需要单位；boolean/text 用不到 */
export const isNumericType = (t: ParamType) => t === 'higher-better' || t === 'lower-better'
