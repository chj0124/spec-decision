import { Crown, Medal, Award } from 'lucide-react'
import type { Preference } from '../../lib/types'

export const RANK_ICON = [Crown, Medal, Award]
export const RANK_STYLE = ['rank-1', 'rank-2', 'rank-3']

/** 分享链接软上限：超过此长度多数聊天工具/邮件会自动截断，改为优先建议走备份文件 */
export const SHARE_URL_SOFT_LIMIT = 2000

// Recharts Tooltip 内部 label 与每个 item 的文字颜色需要单独指定，
// 否则它会用默认深色（#333 之类），在深色背景上"融为一体"看不清。
// 具体配色由 useChartTheme 按亮 / 暗主题给出（见组件内 chartTheme）。

/** 边际效益分级样式映射：row=行底色弱高亮，bar=左侧色条颜色（inline style 用） */
export const GRADE_STYLE: Record<string, { label: string; badge: string; dot: string; row: string; bar: string }> = {
  great: { label: '闭眼入', badge: 'bg-brand/15 text-brand',                        dot: 'bg-brand',      row: 'bg-brand/5',   bar: '#4f46e5' },
  good:  { label: '划算',   badge: 'bg-sky-500/15 text-sky-500 dark:text-sky-400',  dot: 'bg-sky-400',    row: 'bg-sky-500/5', bar: '#0ea5e9' },
  fair:  { label: '持平',   badge: 'bg-slate-500/15 text-slate-500 dark:text-slate-300', dot: 'bg-slate-400', row: '',            bar: '#94a3b8' },
  poor:  { label: '小亏',   badge: 'bg-amber-500/15 text-amber-500 dark:text-amber-400', dot: 'bg-amber-400', row: 'bg-amber-500/5', bar: '#f59e0b' },
  bad:   { label: '不建议', badge: 'bg-red-500/15 text-red-500 dark:text-red-400',  dot: 'bg-red-400',    row: 'bg-red-500/5', bar: '#ef4444' },
}

/** 各决策偏好的静态说明（悬停在切换按钮上时显示） */
export const PREFERENCE_HINT: Record<Preference, string> = {
  value: '只看每单位单价，最便宜的排第 1，参数不参与排名',
  score: '价格分 × 价格权重 + 各参数维度分 × 参数权重，加权总分高的排第 1',
  budget: '先过滤掉总价超预算的规格，再按综合得分排名',
}

/** 主视觉视图类型（四种候选，供减法筛选） */
export type VisualKind = 'price' | 'perYuan' | 'quadrant' | 'savings'

/** 非冠军柱的中性色（亮 / 暗各一） */
export const neutralBar = (dark: boolean) => (dark ? '#52525f' : '#cdc7b8')
