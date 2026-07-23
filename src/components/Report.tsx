import { useEffect, useRef, useState } from 'react'
import type { ComputedSku, DecisionResult, DecisionConfig, Preference, SkuCluster } from '../lib/types'
import { fmt, mergeVariantSkus, parseFlavor, inferFlavorLabel } from '../lib/engine'
import {
  Trophy, ArrowLeft, AlertTriangle, TrendingDown, CheckCircle2,
  Crown, Medal, Award, Lightbulb, Scale, Layers, List, ChevronDown,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts'

interface Props {
  result: DecisionResult
  config: DecisionConfig
  unitWarning?: string | null
  onBack: () => void
  onPreferenceChange: (p: Preference) => void
  onBudgetChange: (budget: number | undefined) => void
}

const RANK_ICON = [Crown, Medal, Award]
const RANK_STYLE = ['rank-1', 'rank-2', 'rank-3']

const tooltipStyle = {
  backgroundColor: '#0f1626',
  border: '1px solid #1c2740',
  borderRadius: '10px',
  fontSize: '12px',
  color: '#e2e8f0',
}
// Recharts Tooltip 内部 label 与每个 item 的文字颜色需要单独指定，
// 否则它会用默认深色（#333 之类），在深色背景上"融为一体"看不清。
const tooltipLabelStyle = { color: '#e2e8f0', marginBottom: '4px' }
const tooltipItemStyle = { color: '#e2e8f0' }

/** 边际效益分级样式映射：row=行底色弱高亮，bar=左侧色条颜色（inline style 用） */
const GRADE_STYLE: Record<string, { label: string; badge: string; dot: string; row: string; bar: string }> = {
  great: { label: '闭眼入', badge: 'bg-cyan-glow/15 text-cyan-glow', dot: 'bg-cyan-glow', row: 'bg-cyan-glow/5',  bar: '#06b6d4' },
  good:  { label: '划算',   badge: 'bg-sky-500/15 text-sky-400',     dot: 'bg-sky-400',     row: 'bg-sky-500/5',    bar: '#0ea5e9' },
  fair:  { label: '持平',   badge: 'bg-slate-500/20 text-slate-300', dot: 'bg-slate-400',   row: '',                bar: '#64748b' },
  poor:  { label: '小亏',   badge: 'bg-amber-500/15 text-amber-400', dot: 'bg-amber-400',   row: 'bg-amber-500/5',  bar: '#f59e0b' },
  bad:   { label: '不建议', badge: 'bg-red-500/15 text-red-400',     dot: 'bg-red-400',     row: 'bg-red-500/5',    bar: '#ef4444' },
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6

/** 第一分组维度（口味/颜色/型号）行底色调色板：与工作台保持一致 */
const FLAVOR_COLORS = [
  'bg-sky-900/20',
  'bg-amber-900/20',
  'bg-emerald-900/20',
  'bg-violet-900/20',
  'bg-rose-900/20',
  'bg-cyan-900/20',
  'bg-orange-900/20',
  'bg-teal-900/20',
]

/** 全量视图分组维度选项 key 类型 */
type FullGroupBy = 'flavor' | 'quantity' | 'packs'

/** 按 dimension 对 ComputedSku 分组（保留派生字段，避免丢 packPrice 等） */
function groupComputedSkus(
  skus: ComputedSku[],
  by: FullGroupBy,
  flavorLabel: string,
): Array<{ key: string; items: ComputedSku[] }> {
  const map = new Map<string, ComputedSku[]>()
  for (const s of skus) {
    let key = ''
    if (by === 'flavor') key = parseFlavor(s.name).flavor || `（无${flavorLabel}）`
    else if (by === 'quantity') key = `${s.quantity}${s.unit}`
    else if (by === 'packs') key = `${s.packs}件`
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(s)
  }
  return [...map.entries()].map(([key, items]) => ({ key, items }))
}

export default function Report({ result, config, unitWarning, onBack, onPreferenceChange, onBudgetChange }: Props) {
  const { items, best, margins, warnings, reasons, clusters, hasVariants } = result
  // 有干扰维度（同定价多口味）时，默认用簇化简视图
  const [view, setView] = useState<'cluster' | 'full'>(hasVariants ? 'cluster' : 'full')
  // 用户手动切换过则尊重其选择；否则跟随数据（识别/导入后 hasVariants 可能变化）
  const userToggled = useRef(false)
  useEffect(() => {
    if (!userToggled.current) setView(hasVariants ? 'cluster' : 'full')
  }, [hasVariants])
  const switchView = (v: 'cluster' | 'full') => {
    userToggled.current = true
    setView(v)
  }

  // 全量视图分组折叠：与工作台一致的工具栏 + 可点击分组标题行
  const [groupBy, setGroupBy] = useState<FullGroupBy | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggleGroup = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const flavorLabel = config.flavorLabel || inferFlavorLabel(config.category)
  // 口味分组底色：按 flavor 值稳定映射到调色板
  const flavorColorMap = new Map<string, string>()
  let flavorColorIdx = 0
  for (const it of items) {
    const f = parseFlavor(it.name).flavor || ''
    if (f && !flavorColorMap.has(f)) {
      flavorColorMap.set(f, FLAVOR_COLORS[flavorColorIdx % FLAVOR_COLORS.length])
      flavorColorIdx++
    }
  }
  // 分组维度候选：过滤掉无区分意义的（所有 SKU 值相同 / 每组仅1项）
  const groupOptions: Array<{ key: FullGroupBy; label: string }> = (() => {
    if (items.length < 3) return []
    const opts: Array<{ key: FullGroupBy; label: string; getVal: (s: ComputedSku) => string }> = [
      { key: 'flavor', label: `按${flavorLabel}`, getVal: (s) => parseFlavor(s.name).flavor || '' },
      { key: 'quantity', label: '按单件含量', getVal: (s) => `${s.quantity}${s.unit}` },
      { key: 'packs', label: '按件数', getVal: (s) => `${s.packs}件` },
    ]
    return opts
      .filter((o) => {
        const vals = new Set(items.map(o.getVal))
        return vals.size >= 2 && vals.size < items.length
      })
      .map(({ key, label }) => ({ key, label }))
  })()

  if (items.length === 0) {
    return (
      <div className="glass rounded-2xl p-12 text-center space-y-4">
        <Scale className="h-12 w-12 mx-auto text-slate-600" />
        <p className="text-slate-400">还没有可对比的规格，先回工作台填写。</p>
        <button
          onClick={onBack}
          className="px-5 py-2.5 rounded-xl bg-cyan-glow/15 text-cyan-glow text-sm font-semibold hover:bg-cyan-glow/25 transition-all inline-flex items-center gap-2"
        >
          <ArrowLeft className="h-4 w-4" /> 返回工作台
        </button>
      </div>
    )
  }

  // 决策单元：簇视图按簇，全量视图按单个规格
  const decisionUnits = view === 'cluster' ? clusters : null

  return (
    <div className="space-y-8">
      {/* 返回 + 决策偏好 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="text-sm text-slate-400 hover:text-cyan-glow transition-colors inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="h-4 w-4" /> 返回编辑
        </button>

        {/* 决策偏好切换 */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-slate-500">决策偏好：</span>
          <div className="flex rounded-lg border border-edge overflow-hidden">
            {([
              { key: 'value', label: '性价比优先' },
              { key: 'score', label: '综合得分优先' },
              { key: 'budget', label: '预算优先' },
            ] as { key: Preference; label: string }[]).map((opt) => (
              <button
                key={opt.key}
                onClick={() => onPreferenceChange(opt.key)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  config.preference === opt.key
                    ? 'bg-cyan-glow/15 text-cyan-glow'
                    : 'text-slate-400 hover:text-brand-deep'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {config.preference === 'budget' && (
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-slate-500">预算</span>
              <input
                type="number"
                min={0}
                value={config.budget ?? ''}
                onChange={(e) =>
                  onBudgetChange(e.target.value === '' ? undefined : parseFloat(e.target.value))
                }
                placeholder="¥"
                className="field py-1 text-xs w-20 tabular"
              />
            </div>
          )}
        </div>
      </div>

      {/* 单位混杂警告 */}
      {unitWarning && (
        <div className="flex gap-3 rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4">
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-700">单位无法直接比价</p>
            <p className="text-xs text-amber-600 mt-0.5 leading-relaxed">{unitWarning}</p>
          </div>
        </div>
      )}

      {/* 冠军推荐 */}
      {best && (
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass rounded-3xl p-6 sm:p-8 relative overflow-hidden"
        >
          <div className="absolute -top-20 -right-20 h-64 w-64 rounded-full bg-cyan-glow/10 blur-3xl" />
          <div className="relative">
            <div className="flex items-center gap-2 text-cyan-glow text-sm font-semibold mb-3">
              <Trophy className="h-4 w-4" /> 本期最划算
            </div>
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
              <div className="flex-1">
                <h2 className="text-3xl sm:text-5xl font-bold tracking-tighter">{best.name}</h2>
                <div className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
                  <div>
                    <div className="text-sm text-slate-400 mb-0.5">每{best.unit}单价</div>
                    <div className="text-2xl font-bold text-cyan-glow tabular">
                      {fmt.priceUnit(best.unitPrice)}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-400 mb-0.5">{best.packs > 1 ? '每包' : '每件'}价格</div>
                    <div className="text-2xl font-bold tabular">{fmt.yuan(best.packPrice)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-400 mb-0.5">综合得分</div>
                    <div className="text-2xl font-bold tabular">{best.score.toFixed(1)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-400 mb-0.5">总价 / 总量</div>
                    <div className="text-2xl font-bold tabular">
                      {fmt.yuan(best.price)}
                      <span className="text-sm text-slate-400 font-normal ml-2">
                        {fmt.num(best.totalQuantity)}{best.unit}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 推荐理由 */}
              <div className="lg:w-96 rounded-2xl bg-brand-soft/60 border border-edge p-5">
                <div className="text-xs font-semibold text-slate-600 mb-3 flex items-center gap-1.5">
                  <Lightbulb className="h-3.5 w-3.5 text-cyan-glow" /> 推荐理由
                </div>
                <ul className="space-y-2">
                  {reasons.map((r, i) => (
                    <li key={i} className="text-xs text-slate-400 leading-relaxed flex gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-cyan-glow shrink-0 mt-0.5" />
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </motion.section>
      )}

      {/* 排名 + 边际效益：大屏左右分栏 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      {/* 排名（支持簇化简 / 全量切换） */}
      <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold tracking-tight">
              {view === 'cluster' ? '决策排名（已按规格聚合）' : '完整排名'}
            </h3>
            {hasVariants && (
              <div className="flex rounded-lg border border-edge overflow-hidden text-xs">
                <button
                  onClick={() => switchView('cluster')}
                  className={`px-3 py-1.5 font-medium flex items-center gap-1.5 transition-colors ${
                    view === 'cluster' ? 'bg-cyan-glow/15 text-cyan-glow' : 'text-slate-400 hover:text-brand-deep'
                  }`}
                >
                  <Layers className="h-3.5 w-3.5" /> 简化视图
                </button>
                <button
                  onClick={() => switchView('full')}
                  className={`px-3 py-1.5 font-medium flex items-center gap-1.5 transition-colors ${
                    view === 'full' ? 'bg-cyan-glow/15 text-cyan-glow' : 'text-slate-400 hover:text-brand-deep'
                  }`}
                >
                  <List className="h-3.5 w-3.5" /> 全部 {items.length} 项
                </button>
              </div>
            )}
          </div>

          {view === 'cluster' && decisionUnits ? (
            <>
              <p className="text-sm text-slate-500 -mt-1">
                已把仅口味/颜色不同、价格结构一致的 {items.length} 个规格折叠为 {decisionUnits.length} 个决策项，
                先比价格、再在卡片内挑口味
              </p>
              {decisionUnits.map((cluster, idx) => (
                <ClusterCard key={cluster.key} cluster={cluster} idx={idx} flavorLabel={flavorLabel} />
              ))}
            </>
          ) : (
            <>
              {/* 分组折叠工具栏：仅当存在可分组维度时显示 */}
              {groupOptions.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span className="text-slate-500">分组折叠：</span>
                  {groupOptions.map((opt) => {
                    const active = groupBy === opt.key
                    return (
                      <button
                        key={opt.key}
                        onClick={() => {
                          setCollapsed(new Set())
                          setGroupBy(active ? null : opt.key)
                        }}
                        className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                          active
                            ? 'bg-cyan-glow/15 text-cyan-glow border border-cyan-glow/50'
                            : 'text-slate-400 hover:text-brand-deep border border-edge'
                        }`}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                  {groupBy && (
                    <button
                      onClick={() => { setCollapsed(new Set()); setGroupBy(null) }}
                      className="text-slate-500 hover:text-slate-600 ml-1"
                    >
                      取消分组
                    </button>
                  )}
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[640px]">
                  <thead>
                    <tr className="border-b border-edge text-left text-sm text-slate-500">
                      <th className="px-2 py-2 font-medium text-center">#</th>
                      <th className="px-2 py-2 font-medium">规格</th>
                      <th className="px-2 py-2 font-medium text-right">总价</th>
                      <th className="px-2 py-2 font-medium text-right">总量</th>
                      <th className="px-2 py-2 font-medium text-right">每{items[0]?.unit ?? ''}</th>
                      <th className="px-2 py-2 font-medium text-right">{items.some((i) => i.packs > 1) ? '每包' : '每件'}</th>
                    </tr>
                  </thead>
                  {/* key 随 groupBy 变化，切换分组维度时整体重挂载 */}
                  <tbody key={groupBy ?? 'none'}>
                    {(groupBy
                      ? groupComputedSkus(items, groupBy, flavorLabel)
                      : [{ key: '__all__', items }]
                    ).map((group) => {
                      const isGrouped = groupBy !== null
                      const isCollapsed = collapsed.has(group.key)
                      return (
                        <RankGroupRows
                          key={group.key}
                          groupKey={group.key}
                          groupItems={group.items}
                          allItems={items}
                          isGrouped={isGrouped}
                          isCollapsed={isCollapsed}
                          onToggle={() => toggleGroup(group.key)}
                          flavorColorMap={flavorColorMap}
                        />
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

      {/* 单价对比 & 边际效益 */}
      {margins.length > 0 && (
        <section className="glass rounded-2xl p-6">
          <h3 className="text-lg font-bold tracking-tight mb-1 flex items-center gap-2">
            <TrendingDown className="h-5 w-5 text-cyan-glow" /> 单价对比 & 边际效益
          </h3>
          <p className="text-xs text-slate-500 mb-5">
            按总量排序 · 阶梯图每段标注升级成本（+¥X）与单价变化（↓Y%） · 绿色=划算，红色=坑
          </p>

          {/* 阶梯图：横轴=总量，纵轴=单价。每段阶梯标注"多花¥X / 降Y%"，直接可视化每次升级值不值 */}
          <div className="mb-6 rounded-xl border border-edge bg-brand-soft/20 p-4">
            <div className="text-sm text-slate-500 mb-2 flex items-center gap-2 flex-wrap">
              <span className="inline-block w-3 h-0.5 bg-cyan-glow" /> 单价阶梯 · 每段标注升级成本与单价变化
              <span className="text-slate-600">· 绿色=单价降（划算），红色=单价涨（坑）</span>
            </div>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                {(() => {
                  const merged = mergeVariantSkus(items)
                  // 智能选择横轴：总量有区分度（max>min）时用总量，否则用规格索引
                  // 例：瑜伽垫/耳机都是1件，总量全是1，用总量做横轴会挤成一个点；改用索引让阶梯沿规格顺序展开
                  const totals = merged.map((m) => m.totalQuantity)
                  const totalMin = Math.min(...totals)
                  const totalMax = Math.max(...totals)
                  const useTotalAsX = totalMax > totalMin
                  const chartData = merged.map((it, i) => {
                    const { spec } = parseFlavor(it.name)
                    const label = spec || it.name
                    return {
                      name: label.length > 10 ? label.slice(0, 10) + '…' : label,
                      [useTotalAsX ? '总量' : '序号']: useTotalAsX ? it.totalQuantity : i,
                      单价: round6(it.unitPrice),
                    }
                  })
                  return (
                    <LineChart
                      data={chartData}
                      margin={{ top: 36, right: 32, bottom: 28, left: 8 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#1c2740" />
                      <XAxis
                        dataKey={useTotalAsX ? '总量' : '序号'}
                        type="number"
                        domain={useTotalAsX ? ['auto', 'auto'] : [0, merged.length - 1]}
                        tick={{ fill: '#64748b', fontSize: 11 }}
                        tickFormatter={(v) =>
                          useTotalAsX ? fmt.num(Number(v)) : (merged[Number(v)] && parseFlavor(merged[Number(v)].name).spec) || ''
                        }
                        label={{ value: useTotalAsX ? '总量' : '规格', fill: '#64748b', fontSize: 11, position: 'insideBottom', offset: -2 }}
                      />
                      <YAxis
                        tick={{ fill: '#64748b', fontSize: 11 }}
                        tickFormatter={(v) => `¥${v}`}
                        width={56}
                      />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelStyle={tooltipLabelStyle}
                        itemStyle={tooltipItemStyle}
                        labelFormatter={(v) =>
                          useTotalAsX ? `总量 ${fmt.num(Number(v))}` : (merged[Number(v)] && parseFlavor(merged[Number(v)].name).spec) || ''
                        }
                        formatter={(v: number) => [`¥${v}`, '单价']}
                      />
                      <Line
                        type="stepAfter"
                        dataKey="单价"
                        stroke="#06b6d4"
                        strokeWidth={2.5}
                        dot={{ fill: '#06b6d4', r: 5 }}
                        activeDot={{ r: 7 }}
                        label={(props: { x?: number; y?: number; index?: number }) => {
                          const { x, y, index } = props
                          if (x == null || y == null || index == null) return <g />
                          // 每段阶梯的中点（当前点与前一点之间）标注升级成本与单价变化
                          // margins[index-1] 对应 merged[index-1] → merged[index] 这一段升级
                          const m = margins[index - 1]
                          if (!m) return <g />
                          // 颜色：单价降=绿，涨=红，持平=灰
                          const drop = m.unitPriceDropPct ?? 0
                          const color = drop > 0.5 ? '#34d399' : drop < -0.5 ? '#f87171' : '#94a3b8'
                          const dropStr = `${drop > 0 ? '↓' : '↑'}${Math.abs(drop).toFixed(1)}%`
                          const costStr = `+¥${m.extraCost.toFixed(0)}`
                          return (
                            <text
                              x={x}
                              y={y - 12}
                              fill={color}
                              stroke="#0b1220"
                              strokeWidth={3}
                              paintOrder="stroke"
                              fontSize={11}
                              fontWeight={700}
                              textAnchor="middle"
                            >
                              {costStr} {dropStr}
                            </text>
                          )
                        }}
                      />
                    </LineChart>
                  )
                })()}
              </ResponsiveContainer>
            </div>
          </div>

          {/* 表格：精细分级 + 关键指标。评级合并到规格列（左侧色条 + 标签），省一列宽度 */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[520px]">
              <thead>
                <tr className="border-b border-edge text-left text-sm text-slate-500">
                  <th className="px-2 py-2 font-medium">规格</th>
                  <th className="px-2 py-2 font-medium text-right">多花</th>
                  <th className="px-2 py-2 font-medium text-right">多得</th>
                  <th className="px-2 py-2 font-medium text-right">单价变化</th>
                  <th className="px-2 py-2 font-medium text-right">多花1元多得</th>
                </tr>
              </thead>
              <tbody>
                {margins.map((m, i) => {
                  const style = GRADE_STYLE[m.grade]
                  // 拆分规格名：优先显示关键规格部分（如 16g×8袋），口味作为副标题
                  const { flavor, spec } = parseFlavor(m.toName)
                  const showShort = spec && spec.length <= 20
                  // 多花1元能多买多少量 = 多得的量 / 多花的钱（边际效率）
                  const perExtraYuan = m.extraCost > 0 ? m.extraQuantity / m.extraCost : 0
                  return (
                    <tr
                      key={i}
                      className={`border-b border-edge/50 hover:bg-brand-soft/30 transition-colors ${style.row}`}
                    >
                      {/* 规格 + 评级合并：左侧 3px 色条标识分级，规格名后跟评级标签 */}
                      <td className="px-2 py-2.5" style={{ borderLeft: `3px solid ${style.bar}` }}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium truncate max-w-[180px]" title={m.toName}>
                            {showShort ? spec : m.toName}
                          </span>
                          {showShort && flavor && (
                            <span className="text-sm text-slate-500 truncate max-w-[140px]">{flavor}</span>
                          )}
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${style.badge}`}>
                            {style.label}
                          </span>
                        </div>
                        <div className="text-sm text-slate-500 mt-0.5">{m.verdict}</div>
                      </td>
                      <td className="px-2 py-2.5 text-right tabular text-brand-deep">{fmt.yuan(m.extraCost)}</td>
                      <td className="px-2 py-2.5 text-right tabular text-brand-deep">{fmt.num(m.extraQuantity)}{m.unit}</td>
                      <td className={`px-2 py-2.5 text-right tabular font-semibold ${m.unitPriceDropPct > 0 ? 'text-cyan-glow' : m.unitPriceDropPct < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                        {m.unitPriceDropPct > 0 ? '-' : m.unitPriceDropPct < 0 ? '+' : ''}{Math.abs(m.unitPriceDropPct).toFixed(1)}%
                      </td>
                      <td className="px-2 py-2.5 text-right tabular font-semibold text-cyan-glow">
                        {perExtraYuan > 0 ? `${fmt.num(perExtraYuan)}${m.unit}` : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* 图例 */}
          <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-500">
            {Object.entries(GRADE_STYLE).map(([k, v]) => (
              <span key={k} className="inline-flex items-center gap-1">
                <span className={`inline-block w-2.5 h-2.5 rounded-sm ${v.dot}`} />
                {v.label}
              </span>
            ))}
          </div>

          {/* 避坑提示：紧贴边际分析下方，下单前看清潜在陷阱 */}
          <div className="mt-6 pt-6 border-t border-edge/60">
            <h4 className="text-sm font-bold tracking-tight mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" /> 避坑提示
            </h4>
            <ul className="space-y-2">
              {warnings.map((w, i) => (
                <li key={i} className="flex gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-slate-600 leading-relaxed">{w}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
      </div>
    </div>
  )
}

/** 簇卡片：一个定价规格 + 簇内多口味标签切换。先比价格，再挑口味。 */
function ClusterCard({ cluster, idx, flavorLabel }: { cluster: SkuCluster; idx: number; flavorLabel: string }) {
  const RankIcon = RANK_ICON[idx]
  // 默认选中簇内最省钱的成员
  const cheapest = cluster.members[0]
  const [activeId, setActiveId] = useState<string>(cheapest?.id ?? '')
  const active = cluster.members.find((m: { id: string }) => m.id === activeId) ?? cheapest
  const hasFlavors = cluster.members.length > 1

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: idx * 0.06 }}
      className={`glass rounded-2xl p-4 ${
        cluster.isBest ? 'ring-1 ring-cyan-glow/50 shadow-glow' : ''
      }`}
    >
      <div className="flex items-center gap-4">
        <div
          className={`h-11 w-11 rounded-xl grid place-items-center shrink-0 font-bold text-white ${
            RANK_STYLE[idx] ?? 'bg-edge text-slate-600'
          }`}
        >
          {RankIcon ? <RankIcon className="h-5 w-5" /> : <span className="tabular">{cluster.rank}</span>}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{cluster.label}</span>
            {cluster.isBest && (
              <span className="text-sm px-1.5 py-0.5 rounded bg-cyan-glow/15 text-cyan-glow font-semibold">
                推荐
              </span>
            )}
            {hasFlavors && (
              <span className="text-sm px-1.5 py-0.5 rounded bg-slate-600/60 text-slate-200">
                {cluster.members.length} 种{flavorLabel}
              </span>
            )}
          </div>
          <div className="text-sm text-slate-500 mt-0.5 tabular">
            {cluster.priceSpread > 0
              ? `${fmt.yuan(cluster.minPrice)} ~ ${fmt.yuan(cluster.maxPrice)}`
              : `${fmt.yuan(active.price)}`}{' '}
            · 共 {fmt.num(cluster.quantity * cluster.packs)}{cluster.unit}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-base font-bold tabular">
            <span className="text-cyan-glow">{fmt.priceUnit(cluster.repUnitPrice)}</span>
            <span className="text-sm text-slate-500 font-normal"> /{cluster.unit}</span>
          </div>
          <div className="text-sm text-slate-500">{cluster.packs > 1 ? '每包' : '每件'} {fmt.yuan(active.price / Math.max(1, cluster.packs))}</div>
        </div>
      </div>

      {/* 簇内口味标签：价格已比完，这里只挑口味 */}
      {hasFlavors && (
        <div className="mt-3 pt-3 border-t border-edge/60">
          <div className="text-sm text-slate-500 mb-2 flex items-center gap-1">
            <ChevronDown className="h-3 w-3" />
            价格结构相同，挑个{flavorLabel}即可
            {cluster.priceSpread > 0 && (
              <span className="text-amber-400/80 ml-1">（{flavorLabel}间有价差，已按最省钱排序）</span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {cluster.members.map((m: { id: string; name: string; price: number; flavor?: string }) => (
              <button
                key={m.id}
                onClick={() => setActiveId(m.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all tabular ${
                  m.id === activeId
                    ? 'bg-cyan-glow/20 text-cyan-glow border border-cyan-glow/50'
                    : 'bg-brand-soft/50 text-slate-400 border border-edge hover:text-brand-deep hover:border-slate-600'
                }`}
              >
                {m.name}
                <span className="ml-1.5 opacity-70">{fmt.yuan(m.price)}</span>
              </button>
            ))}
          </div>
          <AnimatePresence mode="wait">
            <motion.p
              key={activeId}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className="text-sm text-slate-400 mt-2"
            >
              已选 <span className="text-brand-deep font-medium">{active.name}</span>：
              {fmt.yuan(active.price)}，每{active.unit} {fmt.priceUnit(active.unitPrice)}
            </motion.p>
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  )
}

/* ============ 全量视图：分组折叠行 ============ */

interface RankGroupRowsProps {
  groupKey: string
  groupItems: ComputedSku[]
  allItems: ComputedSku[]
  isGrouped: boolean
  isCollapsed: boolean
  onToggle: () => void
  flavorColorMap: Map<string, string>
}

function RankGroupRows({
  groupKey,
  groupItems,
  allItems,
  isGrouped,
  isCollapsed,
  onToggle,
  flavorColorMap,
}: RankGroupRowsProps) {
  // 列数：# + 规格 + 总价 + 总量 + 每单位 + 每包 = 6
  const colCount = 6
  return (
    <>
      {/* 分组标题行（仅分组时显示） */}
      {isGrouped && (
        <tr
          onClick={onToggle}
          className="border-b border-edge bg-brand-soft/60 cursor-pointer hover:bg-brand-soft/70 transition-colors select-none"
        >
          <td colSpan={colCount} className="px-2 py-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
              <ChevronDown
                className={`h-3.5 w-3.5 text-cyan-glow transition-transform duration-200 ${
                  isCollapsed ? '-rotate-90' : ''
                }`}
              />
              <span className="text-cyan-glow">{groupKey}</span>
              <span className="text-slate-500 font-normal">（{groupItems.length} 个规格）</span>
            </div>
          </td>
        </tr>
      )}

      {/* 数据行：折叠时隐藏，分组内排名按 allItems 中的位置 */}
      {!isCollapsed &&
        groupItems.map((item) => {
          // 用全局排名（item.rank 已按得分排序），前三名用奖牌图标
          const idx = allItems.findIndex((x) => x.id === item.id)
          const RankIcon = RANK_ICON[idx]
          const { flavor } = parseFlavor(item.name)
          const flavorBg = flavor ? flavorColorMap.get(flavor) ?? '' : ''
          return (
            <tr
              key={item.id}
              className={`border-b border-edge/50 hover:bg-brand-soft/30 transition-colors ${
                item.isBest ? 'bg-cyan-glow/5' : ''
              } ${flavorBg && !item.isBest ? flavorBg : ''}`}
            >
              <td className="px-2 py-2.5 text-center">
                <div
                  className={`inline-flex h-7 w-7 rounded-lg items-center justify-center font-bold text-white ${
                    RANK_STYLE[idx] ?? 'bg-edge text-slate-600'
                  }`}
                >
                  {RankIcon ? <RankIcon className="h-3.5 w-3.5" /> : (
                    <span className="tabular text-xs">{item.rank}</span>
                  )}
                </div>
              </td>
              <td className="px-2 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate max-w-[180px]" title={item.name}>{item.name}</span>
                  {item.isBest && (
                    <span className="px-1.5 py-0.5 rounded bg-cyan-glow/15 text-cyan-glow text-xs font-semibold">推荐</span>
                  )}
                </div>
              </td>
              <td className="px-2 py-2.5 text-right tabular text-brand-deep">{fmt.yuan(item.price)}</td>
              <td className="px-2 py-2.5 text-right tabular text-brand-deep">{fmt.num(item.totalQuantity)}{item.unit}</td>
              <td className="px-2 py-2.5 text-right tabular font-semibold text-cyan-glow">{fmt.priceUnit(item.unitPrice)}</td>
              <td className="px-2 py-2.5 text-right tabular text-slate-300">{fmt.yuan(item.packPrice)}</td>
            </tr>
          )
        })}
    </>
  )
}
