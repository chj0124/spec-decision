import { useEffect, useRef, useState } from 'react'
import type { DecisionResult, DecisionConfig, Preference, SkuCluster } from '../lib/types'
import { fmt } from '../lib/engine'
import {
  Trophy, ArrowLeft, AlertTriangle, TrendingDown, CheckCircle2,
  Crown, Medal, Award, Lightbulb, Scale, Layers, List, ChevronDown,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  RadarChart, PolarGrid, PolarAngleAxis, Radar, PolarRadiusAxis,
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

  // 雷达图维度：综合分 + 性价比 + 总量 + 各 ParamDim 维度分
  const radarDims: { key: string; label: string }[] = [
    { key: '__score', label: '综合分' },
    { key: '__value', label: '性价比' },
    { key: '__total', label: '总量' },
    ...config.dims.map((d) => ({ key: d.id, label: d.label })),
  ]

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

  const barSource = view === 'cluster' && clusters.length > 0
    ? clusters.map((c) => ({ name: c.label, 单价: c.repUnitPrice, isBest: c.isBest }))
    : items.map((i) => ({
        name: i.name.length > 10 ? i.name.slice(0, 10) + '…' : i.name,
        单价: i.unitPrice, isBest: i.isBest,
      }))

  const chartItems = view === 'cluster' && clusters.length > 0 ? null : items
  const maxTotal = Math.max(...items.map((i) => i.totalQuantity), 1)

  // 取某个 SKU/Cluster 在某维度的归一化分（0-100）
  const getDimScore = (
    source: typeof items[0] | (typeof clusters[0] extends { members: (infer M)[] } ? M : never),
    key: string,
  ): number => {
    const it = source as { score: number; unitPrice: number; totalQuantity: number; dimScores?: Record<string, number> }
    if (key === '__score') return Math.round(it.score)
    if (key === '__value') {
      const maxP = Math.max(...items.map((x) => x.unitPrice), 1)
      return Math.round((1 - it.unitPrice / maxP) * 100)
    }
    if (key === '__total') return Math.round((it.totalQuantity / maxTotal) * 100)
    return it.dimScores?.[key] ?? 0
  }

  const radarSubjects = view === 'cluster' && clusters.length > 0
    ? clusters.map((c) => ({ name: c.label, ref: c.members[0] }))
    : items.map((i) => ({ name: i.name, ref: i }))

  const radarData = radarDims.map((d) => {
    const row: Record<string, number | string> = { dim: d.label }
    for (const s of radarSubjects) {
      row[s.name] = getDimScore(s.ref, d.key)
    }
    return row
  })

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
          <span className="text-[11px] text-slate-500">决策偏好：</span>
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
              <span className="text-[11px] text-slate-500">预算</span>
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
                    <div className="text-[11px] text-slate-400 mb-0.5">每{best.unit}单价</div>
                    <div className="text-2xl font-bold text-cyan-glow tabular">
                      {fmt.price4(best.unitPrice)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400 mb-0.5">综合得分</div>
                    <div className="text-2xl font-bold tabular">{best.score.toFixed(1)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400 mb-0.5">总价 / 总量</div>
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

      {/* 排名列表 + 图表 */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* 排名（支持簇化简 / 全量切换） */}
        <section className="lg:col-span-3 space-y-3">
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
              <p className="text-[11px] text-slate-500 -mt-1">
                已把仅口味/颜色不同、价格结构一致的 {items.length} 个规格折叠为 {decisionUnits.length} 个决策项，
                先比价格、再在卡片内挑口味
              </p>
              {decisionUnits.map((cluster, idx) => (
                <ClusterCard key={cluster.key} cluster={cluster} idx={idx} />
              ))}
            </>
          ) : (
            items.map((item, idx) => {
              const RankIcon = RANK_ICON[idx]
              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.06 }}
                  className={`glass rounded-2xl p-4 flex items-center gap-4 ${
                    item.isBest ? 'ring-1 ring-cyan-glow/50 shadow-glow' : ''
                  }`}
                >
                  <div
                    className={`h-11 w-11 rounded-xl grid place-items-center shrink-0 font-bold text-white ${
                      RANK_STYLE[idx] ?? 'bg-edge text-slate-600'
                    }`}
                  >
                    {RankIcon ? <RankIcon className="h-5 w-5" /> : (
                      <span className="tabular">{item.rank}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm truncate">{item.name}</span>
                      {item.isBest && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-glow/15 text-cyan-glow font-semibold">
                          推荐
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5 tabular">
                      {fmt.yuan(item.price)} · {fmt.num(item.totalQuantity)}{item.unit}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-base font-bold text-cyan-glow tabular">
                      {fmt.price4(item.unitPrice)}
                    </div>
                    <div className="text-[10px] text-slate-500">/{item.unit}</div>
                  </div>
                  <div className="hidden sm:block w-24 shrink-0">
                    <div className="text-[10px] text-slate-500 mb-1 text-right tabular">
                      {item.score.toFixed(0)}分
                    </div>
                    <div className="h-1.5 rounded-full bg-edge overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${item.score}%` }}
                        transition={{ duration: 0.8, delay: 0.2 + idx * 0.06, ease: [0.16, 1, 0.3, 1] }}
                        className="h-full rounded-full bg-gradient-to-r from-brand to-emerald-600"
                      />
                    </div>
                  </div>
                </motion.div>
              )
            })
          )}
        </section>

        {/* 图表 */}
        <section className="lg:col-span-2 space-y-6">
          <div className="glass rounded-2xl p-5">
            <h4 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-cyan-glow" />
              每{items[0].unit}单价对比（越低越好）
            </h4>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={barSource} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(34,211,238,0.06)' }} />
                <Bar dataKey="单价" radius={[6, 6, 0, 0]}>
                  {barSource.map((d, i) => (
                    <Cell key={i} fill={d.isBest ? '#22d3ee' : '#1c2740'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="glass rounded-2xl p-5">
            <h4 className="text-sm font-semibold mb-4">多维能力雷达</h4>
            <ResponsiveContainer width="100%" height={240}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="#1c2740" />
                <PolarAngleAxis dataKey="dim" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <PolarRadiusAxis tick={false} axisLine={false} domain={[0, 100]} />
                {(view === 'cluster' ? clusters : items).slice(0, 4).map((unit: any) => {
                  const key = view === 'cluster' ? unit.label : unit.name
                  return (
                    <Radar
                      key={key}
                      dataKey={key}
                      stroke={unit.isBest ? '#22d3ee' : '#475569'}
                      fill={unit.isBest ? '#22d3ee' : '#475569'}
                      fillOpacity={unit.isBest ? 0.25 : 0.05}
                      strokeWidth={unit.isBest ? 2 : 1}
                    />
                  )
                })}
                <Tooltip contentStyle={tooltipStyle} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      {/* 边际效益 + 避坑 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 边际效益 */}
        <section className="glass rounded-2xl p-6">
          <h3 className="text-lg font-bold tracking-tight mb-1 flex items-center gap-2">
            <TrendingDown className="h-5 w-5 text-cyan-glow" /> 边际效益分析
          </h3>
          <p className="text-xs text-slate-500 mb-5">
            以单价最低的「{result.baseline?.name}」为基准，评估买大包装值不值
          </p>
          <div className="space-y-3">
            {margins.map((m, i) => (
              <div
                key={i}
                className={`rounded-xl border p-4 ${
                  m.worthIt
                    ? 'border-cyan-glow/30 bg-cyan-glow/5'
                    : 'border-edge bg-brand-soft/50'
                }`}
              >
                <div className="flex items-center justify-between gap-3 mb-2">
                  <span className="text-sm font-semibold truncate">{m.toName}</span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 ${
                      m.worthIt ? 'bg-cyan-glow/15 text-cyan-glow' : 'bg-slate-700/50 text-slate-400'
                    }`}
                  >
                    {m.worthIt ? '值得升级' : '不太划算'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">{m.verdict}</p>
                <div className="mt-3 flex gap-4 text-[11px] tabular">
                  <span className="text-slate-500">
                    多花 <span className="text-brand-deep">{fmt.yuan(m.extraCost)}</span>
                  </span>
                  <span className="text-slate-500">
                    多得 <span className="text-brand-deep">{fmt.num(m.extraQuantity)}{m.unit}</span>
                  </span>
                  <span className="text-slate-500">
                    单价变化{' '}
                    <span className={m.unitPriceDropPct > 0 ? 'text-cyan-glow' : 'text-red-400'}>
                      {m.unitPriceDropPct > 0 ? '-' : '+'}{Math.abs(m.unitPriceDropPct).toFixed(1)}%
                    </span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 避坑提示 */}
        <section className="glass rounded-2xl p-6">
          <h3 className="text-lg font-bold tracking-tight mb-1 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-400" /> 避坑提示
          </h3>
          <p className="text-xs text-slate-500 mb-5">下单前，先看清这些潜在的坑</p>
          <ul className="space-y-3">
            {warnings.map((w, i) => (
              <li key={i} className="flex gap-3 rounded-xl border border-amber-400/20 bg-amber-400/5 p-4">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-slate-600 leading-relaxed">{w}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

/** 簇卡片：一个定价规格 + 簇内多口味标签切换。先比价格，再挑口味。 */
function ClusterCard({ cluster, idx }: { cluster: SkuCluster; idx: number }) {
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
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-glow/15 text-cyan-glow font-semibold">
                推荐
              </span>
            )}
            {hasFlavors && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">
                {cluster.members.length} 种口味
              </span>
            )}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5 tabular">
            {cluster.priceSpread > 0
              ? `${fmt.yuan(cluster.minPrice)} ~ ${fmt.yuan(cluster.maxPrice)}`
              : `${fmt.yuan(active.price)}`}{' '}
            · 共 {fmt.num(cluster.quantity * cluster.packs)}{cluster.unit}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-base font-bold text-cyan-glow tabular">
            {fmt.price4(cluster.repUnitPrice)}
          </div>
          <div className="text-[10px] text-slate-500">/{cluster.unit}起</div>
        </div>
        <div className="hidden sm:block w-24 shrink-0">
          <div className="text-[10px] text-slate-500 mb-1 text-right tabular">
            {cluster.score.toFixed(0)}分
          </div>
          <div className="h-1.5 rounded-full bg-edge overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${cluster.score}%` }}
              transition={{ duration: 0.8, delay: 0.2 + idx * 0.06, ease: [0.16, 1, 0.3, 1] }}
              className="h-full rounded-full bg-gradient-to-r from-brand to-emerald-600"
            />
          </div>
        </div>
      </div>

      {/* 簇内口味标签：价格已比完，这里只挑口味 */}
      {hasFlavors && (
        <div className="mt-3 pt-3 border-t border-edge/60">
          <div className="text-[10px] text-slate-500 mb-2 flex items-center gap-1">
            <ChevronDown className="h-3 w-3" />
            价格结构相同，挑个口味即可
            {cluster.priceSpread > 0 && (
              <span className="text-amber-400/80 ml-1">（口味间有价差，已按最省钱排序）</span>
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
              className="text-[11px] text-slate-400 mt-2"
            >
              已选 <span className="text-brand-deep font-medium">{active.name}</span>：
              {fmt.yuan(active.price)}，每{active.unit} {fmt.price4(active.unitPrice)}
            </motion.p>
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  )
}
