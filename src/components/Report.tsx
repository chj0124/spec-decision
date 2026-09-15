import { useEffect, useRef, useState } from 'react'
import type { ComputedSku, DecisionResult, DecisionConfig, Preference, SkuCluster, MarginInsight } from '../lib/types'
import { fmt, isStale, STALE_DAYS, mergeVariantSkus, parseFlavor, inferFlavorLabel, priceTrend, fmtPointDay, displayUnit, displayQuantity, displayUnitPrice } from '../lib/engine'
import {
  Trophy, ArrowLeft, AlertTriangle, TrendingDown, TrendingUp, CheckCircle2,
  Crown, Medal, Award, Lightbulb, Scale, Layers, List, ChevronDown, RefreshCw,
  Printer, Copy, Check, Share2, Minus, ImageDown, Loader2,
} from 'lucide-react'
import { motion, AnimatePresence, animate } from 'framer-motion'
import { useChartTheme, type ChartTheme } from '../lib/useChartTheme'
import { exportNodeToPng, buildReportFileName, EXPORT_BG } from '../lib/exportImage'
import {
  Bar, BarChart, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ComposedChart, Line, Cell, ReferenceLine, ReferenceDot,
} from 'recharts'

interface Props {
  result: DecisionResult
  config: DecisionConfig
  unitWarning?: string | null
  onBack: () => void
  onPreferenceChange: (p: Preference) => void
  onBudgetChange: (budget: number | undefined) => void
  /** 生成可分享链接（只读视图下不传，则不显示分享按钮） */
  getShareUrl?: () => Promise<string>
}

const RANK_ICON = [Crown, Medal, Award]
const RANK_STYLE = ['rank-1', 'rank-2', 'rank-3']

/** 分享链接软上限：超过此长度多数聊天工具/邮件会自动截断，改为优先建议走备份文件 */
const SHARE_URL_SOFT_LIMIT = 2000

// Recharts Tooltip 内部 label 与每个 item 的文字颜色需要单独指定，
// 否则它会用默认深色（#333 之类），在深色背景上"融为一体"看不清。
// 具体配色由 useChartTheme 按亮 / 暗主题给出（见组件内 chartTheme）。

/** 边际效益分级样式映射：row=行底色弱高亮，bar=左侧色条颜色（inline style 用） */
const GRADE_STYLE: Record<string, { label: string; badge: string; dot: string; row: string; bar: string }> = {
  great: { label: '闭眼入', badge: 'bg-brand/15 text-brand',                        dot: 'bg-brand',      row: 'bg-brand/5',   bar: '#4f46e5' },
  good:  { label: '划算',   badge: 'bg-sky-500/15 text-sky-500 dark:text-sky-400',  dot: 'bg-sky-400',    row: 'bg-sky-500/5', bar: '#0ea5e9' },
  fair:  { label: '持平',   badge: 'bg-slate-500/15 text-slate-500 dark:text-slate-300', dot: 'bg-slate-400', row: '',            bar: '#94a3b8' },
  poor:  { label: '小亏',   badge: 'bg-amber-500/15 text-amber-500 dark:text-amber-400', dot: 'bg-amber-400', row: 'bg-amber-500/5', bar: '#f59e0b' },
  bad:   { label: '不建议', badge: 'bg-red-500/15 text-red-500 dark:text-red-400',  dot: 'bg-red-400',    row: 'bg-red-500/5', bar: '#ef4444' },
}

/** 数字滚动递增：冠军卡核心指标挂载时从 0 滚动到目标值（尊重"减少动态效果"系统偏好） */
function CountUp({ value, format, className }: { value: number; format: (n: number) => string; className?: string }) {
  const [text, setText] = useState(() => format(value))
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setText(format(value))
      return
    }
    const controls = animate(0, value, {
      duration: 0.7,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setText(format(v)),
    })
    return () => controls.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return <span className={className}>{text}</span>
}

/** 一句话结论 / 图表轴标签里的短名：优先「口味·规格」，超长截断 */
function shortSpec(name: string): string {
  const { spec, flavor } = parseFlavor(name)
  if (spec && spec.length <= 12) return flavor ? `${flavor}·${spec}` : spec
  return name.length > 12 ? name.slice(0, 12) + '…' : name
}

/**
 * 每件量词：优先用商品实际的件数量词（瓶/罐/袋/盒…），
 * 没有再按"是否多件"回退——多件用「包」、单件用「件」。
 * 这样瓶装饮料会显示"每瓶价格"而不是硬编码的"每包价格"。
 */
const packWord = (packs: number, packUnit?: string): string =>
  packUnit || (packs > 1 ? '包' : '件')

/** 列表级每件量词：取列表里实际出现过的量词，没有则回退 */
const listPackWord = (items: ComputedSku[]): string =>
  items.find((i) => i.packUnit)?.packUnit || (items.some((i) => i.packs > 1) ? '包' : '件')

/** 写剪贴板：优先 Clipboard API，非安全上下文/旧浏览器回退 execCommand */
async function writeClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    /* 继续走回退路径 */
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  try { document.execCommand('copy') } catch { /* 尽力而为 */ }
  document.body.removeChild(ta)
}

/** 生成纯文本决策摘要（复制到剪贴板 / 导出用） */
function buildSummaryText(result: DecisionResult, config: DecisionConfig): string {
  const { best, items, reasons, warnings, margins } = result
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

/** 第一分组维度（口味/颜色/型号）行底色调色板：与工作台保持一致（亮 / 暗双模式） */
const FLAVOR_COLORS = [
  'bg-sky-100/60 dark:bg-sky-900/20',
  'bg-amber-100/60 dark:bg-amber-900/20',
  'bg-emerald-100/60 dark:bg-emerald-900/20',
  'bg-violet-100/60 dark:bg-violet-900/20',
  'bg-rose-100/60 dark:bg-rose-900/20',
  'bg-cyan-100/60 dark:bg-cyan-900/20',
  'bg-orange-100/60 dark:bg-orange-900/20',
  'bg-teal-100/60 dark:bg-teal-900/20',
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

/* ============ 主视觉：围绕「每单位单价」这一个标尺的四种看法 ============ */

/** 主视觉视图类型（四种候选，供减法筛选） */
type VisualKind = 'price' | 'perYuan' | 'quadrant' | 'savings'

/** 主视觉用的单条规格（已合并同价同规格的口味变体，并按展示单位换算） */
interface SpecRow {
  id: string
  /** 轴标签短名 */
  name: string
  /** 悬停 tooltip 用的完整名 */
  fullName: string
  /** 每展示单位单价（如 ¥/L） */
  perUnit: number
  /** 总量（展示单位） */
  qty: number
  /** 每 100 元能买到的展示单位量 */
  per100: number
  /** 相对全场最贵单价、按本档总量折算出的省下金额（¥） */
  savings: number
}

/** 非冠军柱的中性色（亮 / 暗各一） */
const neutralBar = (dark: boolean) => (dark ? '#52525f' : '#cdc7b8')

/**
 * 性价比主视觉：同一份数据四种编码方式，都只围绕「每单位单价」。
 * - price    每单位单价横条（越短越省 + 平均线）
 * - perYuan  每 100 元买到多少（越长越划算）
 * - quadrant 性价比象限（总量 × 单价，连线即升档路径）
 * - savings  相对最贵档省下多少钱（绝对金额）
 * 冠军条统一高亮，其余中性色。
 */
function MainVisual({
  kind, rows, unitLabel, anchorId, theme,
}: {
  kind: VisualKind
  rows: SpecRow[]
  unitLabel: string
  anchorId: string
  theme: ChartTheme
}) {
  const tooltipProps = {
    contentStyle: theme.tooltipStyle,
    labelStyle: theme.tooltipLabelStyle,
    itemStyle: theme.tooltipItemStyle,
  }
  const fullNameOf = (value: unknown, payload?: Array<{ payload?: SpecRow }>) =>
    payload?.[0]?.payload?.fullName ?? String(value)

  // 象限图：横轴总量（升序连线=升档路径）、纵轴每单位单价，绿点标最划算
  if (kind === 'quadrant') {
    const data = [...rows].sort((a, b) => a.qty - b.qty)
    const avgQty = data.reduce((s, r) => s + r.qty, 0) / Math.max(1, data.length)
    const avgUnit = data.reduce((s, r) => s + r.perUnit, 0) / Math.max(1, data.length)
    const anchor = data.find((r) => r.id === anchorId) ?? data[0]
    return (
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 24, right: 24, bottom: 44, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
            <XAxis
              type="number"
              dataKey="qty"
              tick={{ fill: theme.tick, fontSize: 11 }}
              tickFormatter={(v) => fmt.num(v)}
              label={{ value: `总量（${unitLabel}）→ 越右越大份`, position: 'insideBottom', offset: -28, fill: theme.tick, fontSize: 11 }}
            />
            <YAxis
              type="number"
              dataKey="perUnit"
              tick={{ fill: theme.tick, fontSize: 11 }}
              tickFormatter={(v) => `¥${v}`}
              width={62}
              label={{ value: `每${unitLabel}单价 ↓ 越低越省`, angle: -90, position: 'insideLeft', fill: theme.tick, fontSize: 11 }}
            />
            {/* 平均线：右下象限 = 又大份又便宜 */}
            <ReferenceLine x={avgQty} stroke={theme.tick} strokeDasharray="4 4" />
            <ReferenceLine y={avgUnit} stroke={theme.tick} strokeDasharray="4 4" />
            <Tooltip
              {...tooltipProps}
              labelFormatter={fullNameOf}
              formatter={(value, name) => [fmt.priceUnit(Number(value)), String(name)]}
            />
            <Line
              dataKey="perUnit"
              name={`每${unitLabel}单价`}
              type="monotone"
              stroke={theme.series.unitPrice}
              strokeWidth={2.4}
              dot={{ r: 5, fill: theme.series.unitPrice }}
              activeDot={{ r: 7 }}
            />
            {anchor && (
              <ReferenceDot x={anchor.qty} y={anchor.perUnit} r={7} fill={theme.series.drop} stroke={theme.label.stroke} strokeWidth={2} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    )
  }

  // 三种横条：单价 / 每元买到 / 省下金额
  const isSavings = kind === 'savings'
  const isPerYuan = kind === 'perYuan'
  const dataKey: keyof Pick<SpecRow, 'perUnit' | 'per100' | 'savings'> =
    isSavings ? 'savings' : isPerYuan ? 'per100' : 'perUnit'
  const valueText = (v: number) =>
    isSavings ? fmt.yuan(v) : isPerYuan ? `${fmt.num(v)}${unitLabel}` : fmt.priceUnit(v)
  const seriesName = isSavings ? '省下' : isPerYuan ? '每 100 元买到' : `每${unitLabel}单价`
  const axisLabel = isSavings
    ? '省下金额（元）→'
    : isPerYuan
      ? `每 100 元买到的量（${unitLabel}）→`
      : `每${unitLabel}单价（元）→`
  // 单价 / 每元买到：从优到劣（省的排上面）；省下金额：从多到少
  const data = [...rows].sort((a, b) =>
    isSavings ? b.savings - a.savings : isPerYuan ? b.per100 - a.per100 : a.perUnit - b.perUnit,
  )
  const avg = data.reduce((s, r) => s + r[dataKey], 0) / Math.max(1, data.length)
  const chartHeight = Math.max(220, data.length * 40 + 60)

  return (
    <div style={{ height: chartHeight }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart layout="vertical" data={data} margin={{ top: 8, right: 72, bottom: 24, left: 4 }} barCategoryGap={12}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} horizontal={false} />
          <XAxis
            type="number"
            tick={{ fill: theme.tick, fontSize: 11 }}
            tickFormatter={(v) => (isSavings || !isPerYuan ? `¥${v}` : `${v}`)}
            label={{ value: axisLabel, position: 'insideBottom', offset: -14, fill: theme.tick, fontSize: 11 }}
          />
          <YAxis type="category" dataKey="name" width={94} interval={0} tick={{ fill: theme.tick, fontSize: 11 }} />
          <Tooltip
            cursor={{ fill: theme.cursorFill }}
            {...tooltipProps}
            labelFormatter={fullNameOf}
            formatter={(value) => [valueText(Number(value)), seriesName]}
          />
          {/* 平均线只在"越短越省"的单价图上画（每元/省下越高越好，平均线容易被误读） */}
          {kind === 'price' && (
            <ReferenceLine x={avg} stroke={theme.tick} strokeDasharray="4 4" label={{ value: '平均', position: 'top', fill: theme.tick, fontSize: 10 }} />
          )}
          <Bar dataKey={dataKey} name={seriesName} radius={[0, 6, 6, 0]} maxBarSize={24}
            label={(props: { x?: number; y?: number; width?: number; height?: number; value?: number }) => {
              const { x, y, width, height, value } = props
              if (x == null || y == null || width == null || height == null || value == null) return <g />
              return (
                <text
                  x={x + width + 6}
                  y={y + height / 2}
                  dominantBaseline="middle"
                  fill={theme.label.fill}
                  stroke={theme.label.stroke}
                  strokeWidth={3}
                  paintOrder="stroke"
                  fontSize={11}
                  fontWeight={700}
                >
                  {valueText(value)}
                </text>
              )
            }}
          >
            {data.map((r) => (
              <Cell
                key={r.id}
                fill={r.id === anchorId ? (isSavings ? theme.series.drop : theme.series.unitPrice) : neutralBar(theme.dark)}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ============ 升档判断：一张卡说清一档升级值不值 ============ */

/** 升档卡片：多花 / 多得 / 每单位变化 + 最醒目的「净省」金额 */
function UpgradeCard({ m }: { m: MarginInsight }) {
  const style = GRADE_STYLE[m.grade]
  const unitLabel = displayUnit(m.unit)
  const pct = m.unitPriceDropPct
  return (
    <div
      className={`rounded-2xl border border-edge p-4 ${style.row}`}
      style={{ borderLeft: `3px solid ${style.bar}` }}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <span className="text-slate-500 truncate max-w-[150px]" title={m.fromName}>{shortSpec(m.fromName)}</span>
            <span className="text-slate-400">→</span>
            <span className="font-semibold truncate max-w-[180px]" title={m.toName}>{shortSpec(m.toName)}</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${style.badge}`}>{style.label}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
            <span>多花 <b className="tabular text-slate-600">{fmt.yuan(m.extraCost)}</b></span>
            <span>多得 <b className="tabular text-slate-600">{fmt.num(displayQuantity(m.extraQuantity, m.unit))}{unitLabel}</b></span>
            <span>
              每{unitLabel}
              <b className={`tabular ml-1 ${pct > 0 ? 'text-emerald-500' : pct < 0 ? 'text-amber-500' : 'text-slate-500'}`}>
                {pct > 0 ? `便宜 ${pct.toFixed(1)}%` : pct < 0 ? `反贵 ${Math.abs(pct).toFixed(1)}%` : '持平'}
              </b>
            </span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs text-slate-500">{m.netSaving >= 0 ? '净省（白赚）' : '净多花'}</div>
          <div className={`text-2xl font-bold tabular ${m.netSaving >= 0 ? 'text-emerald-500' : 'text-amber-500'}`}>
            {fmt.yuan(Math.abs(m.netSaving))}
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-400 leading-relaxed">{m.verdict}</p>
    </div>
  )
}

export default function Report({ result, config, unitWarning, onBack, onPreferenceChange, onBudgetChange, getShareUrl }: Props) {
  const { items, best, margins, warnings, reasons, clusters, hasVariants } = result
  const chartTheme = useChartTheme()
  // 冠军规格的价格走势：跨天变过价（≥2 条记录）时才有，用于提示"现在买是不是比上次贵"
  const bestTrend = priceTrend(best?.priceHistory)
  const TrendIcon = bestTrend?.direction === 'up' ? TrendingUp : bestTrend?.direction === 'down' ? TrendingDown : Minus
  // 冠军价格最近一次记录的时间：结论是基于"什么时候的价格"必须说清楚。
  // 注意走势横幅只在 ≥2 条记录时出现，而"过期"只要 1 条记录就能判断，所以这里单独算。
  const bestPriceAt = best?.priceHistory?.[best.priceHistory.length - 1]?.t
  const bestStale = isStale(bestPriceAt)

  // 导出整份报告为 PNG：依赖 html-to-image，按需动态加载（见 lib/exportImage）
  const reportRef = useRef<HTMLDivElement>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const exportPng = async () => {
    const node = reportRef.current
    if (!node || exporting) return
    setExporting(true)
    setExportError(null)
    try {
      const dark = document.documentElement.classList.contains('dark')
      await exportNodeToPng(node, {
        fileName: `${buildReportFileName(config.category)}.png`,
        background: dark ? EXPORT_BG.dark : EXPORT_BG.light,
      })
    } catch {
      setExportError('导出图片失败，可改用「打印 / PDF」另存为 PDF 或图片。')
    } finally {
      setExporting(false)
    }
  }

  // 复制决策摘要到剪贴板（2 秒后恢复按钮文案）
  const [copied, setCopied] = useState(false)
  const copySummary = async () => {
    const text = buildSummaryText(result, config)
    if (!text) return
    await writeClipboard(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // 生成只读分享链接并复制（数据压缩进 URL hash，无需后端）
  const [shareCopied, setShareCopied] = useState(false)
  const [sharing, setSharing] = useState(false)
  // 超长链接护栏：部分聊天工具/邮件会截断超长 URL，超过阈值先提示改用备份文件
  const [shareTooLong, setShareTooLong] = useState<{ url: string; len: number } | null>(null)
  const copyShareLink = async () => {
    if (!getShareUrl || sharing) return
    setSharing(true)
    try {
      const url = await getShareUrl()
      if (url.length > SHARE_URL_SOFT_LIMIT) {
        setShareCopied(false)
        setShareTooLong({ url, len: url.length })
        return
      }
      setShareTooLong(null)
      await writeClipboard(url)
      setShareCopied(true)
      setTimeout(() => setShareCopied(false), 2500)
    } finally {
      setSharing(false)
    }
  }

  const forceCopyShareLink = async () => {
    if (!shareTooLong) return
    await writeClipboard(shareTooLong.url)
    setShareTooLong(null)
    setShareCopied(true)
    setTimeout(() => setShareCopied(false), 2500)
  }

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

  // 主视觉类型：四种候选编码方式，默认「每单位单价」最直接
  const [visual, setVisual] = useState<VisualKind>('price')
  // 逐档明细表默认收起：升档卡片已把结论说完，明细按需展开
  const [showMarginTable, setShowMarginTable] = useState(false)
  // 完整排名表默认收起：报告先给结论，明细按需展开
  const [showDetail, setShowDetail] = useState(false)

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
    // 区分两种空态：真没数据 vs 预算偏好下全部规格超预算被过滤
    const budgetEmpty = config.preference === 'budget' && result.budgetExcluded > 0
    return (
      <div className="glass rounded-2xl p-12 text-center space-y-4">
        <Scale className="h-12 w-12 mx-auto text-slate-600" />
        {budgetEmpty ? (
          <>
            <p className="text-slate-400">
              预算 <span className="text-brand font-semibold">{fmt.yuan(config.budget ?? 0)}</span> 内没有可用规格
              （{result.budgetExcluded} 个规格全部超出预算）。
            </p>
            <p className="text-sm text-slate-500 -mt-2">可直接放宽预算，或切换为「性价比优先 / 综合得分优先」再看。</p>
          </>
        ) : (
          <p className="text-slate-400">还没有可对比的规格，先回工作台填写。</p>
        )}
        {/* 空态自愈：预算偏好下的空态不该只能退回工作台，就地放宽预算 / 换偏好即可继续看报告 */}
        {budgetEmpty && (
          <div className="flex items-center justify-center gap-2 flex-wrap pt-1">
            <label className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500">预算</span>
              <input
                type="number"
                min={0}
                value={config.budget ?? ''}
                onChange={(e) =>
                  onBudgetChange(e.target.value === '' ? undefined : parseFloat(e.target.value))
                }
                placeholder="¥"
                className="field py-1.5 text-sm w-28 tabular text-center"
              />
            </label>
            <button
              onClick={() => onPreferenceChange('value')}
              className="px-4 py-2 rounded-xl bg-brand/15 text-brand text-sm font-semibold hover:bg-brand/25 transition-all"
            >
              改为「性价比优先」
            </button>
          </div>
        )}
        <button
          onClick={onBack}
          className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-500 border border-edge hover:text-brand-deep hover:border-brand/40 transition-all inline-flex items-center gap-2"
        >
          <ArrowLeft className="h-4 w-4" /> {budgetEmpty ? '返回调整' : '返回工作台'}
        </button>
      </div>
    )
  }

  // 决策单元：簇视图按簇，全量视图按单个规格
  const decisionUnits = view === 'cluster' ? clusters : null

  // 主视觉数据：先合并「同价同规格」的口味变体，再统一换算到展示单位（ml→L），
  // 让「每单位单价」成为全场唯一标尺。省下金额 = 相比全场最贵单价、按本档总量折算。
  const specRows: SpecRow[] = (() => {
    const rows: SpecRow[] = mergeVariantSkus(items).map((m) => {
      const perUnit = displayUnitPrice(m.unitPrice, m.unit)
      return {
        id: m.id,
        name: shortSpec(m.name),
        fullName: m.name,
        // 单价保留 4 位小数：升档到"每瓶便宜 0.008 元"这种量级也能看出差别
        perUnit: Math.round(perUnit * 1e4) / 1e4,
        qty: displayQuantity(m.totalQuantity, m.unit),
        per100: perUnit > 0 ? Math.round((100 / perUnit) * 100) / 100 : 0,
        savings: 0,
      }
    })
    const maxPerUnit = rows.reduce((mx, r) => Math.max(mx, r.perUnit), 0)
    for (const r of rows) r.savings = Math.round((maxPerUnit - r.perUnit) * r.qty * 100) / 100
    return rows
  })()
  // 展示单位标签（L / kg / 件…）：取列表里实际出现的单位换算结果
  const visualUnit = displayUnit(items[0]?.unit ?? '')
  // 高亮锚点：优先冠军规格；万一它被合并进同价变体，就退而选单价最低的那条
  const visualAnchorId =
    specRows.find((r) => r.id === best?.id)?.id ??
    specRows.reduce((min, r) => (r.perUnit < min.perUnit ? r : min), specRows[0]).id

  // 一句话结论：把"最划算"折算成「每单位省了多少钱 + 便宜百分之几 + 等量能省多少」，
  // 不读表格也能直接拿到性价比结论。
  const oneLiner = (() => {
    if (specRows.length < 2) return null
    const anchor = specRows.find((r) => r.id === visualAnchorId)
    if (!anchor || anchor.perUnit <= 0) return null
    let worst = specRows[0]
    for (const r of specRows) if (r.perUnit > worst.perUnit) worst = r
    if (worst.id === anchor.id) return null
    const savePerUnit = worst.perUnit - anchor.perUnit
    return {
      anchor,
      worst,
      savePerUnit,
      pct: (savePerUnit / worst.perUnit) * 100,
      vsWorst: savePerUnit * anchor.qty,
    }
  })()

  // 主视觉候选（四种编码方式都做出来，后续按效果做减法）
  const VISUAL_OPTIONS: Array<{ k: VisualKind; label: string; hint: string }> = [
    { k: 'price', label: '每单位单价', hint: `横条越短越省：同一标尺下每${visualUnit}要花多少钱，虚线是全场平均价。` },
    { k: 'perYuan', label: '每元买到多少', hint: `横条越长越划算：同样 100 元，这一档能买到多少${visualUnit}。` },
    { k: 'quadrant', label: '性价比象限', hint: '越靠右下越好：总量更大（右）、每单位更便宜（下）；连线即逐档升档路径。' },
    { k: 'savings', label: '省下多少钱', hint: '相比全场最贵单价、按本档总量折算，选这一档实际省下的金额（元）。' },
  ]
  const activeVisual = VISUAL_OPTIONS.find((o) => o.k === visual) ?? VISUAL_OPTIONS[0]

  return (
    <div ref={reportRef} className="space-y-8">
      {/* 返回 + 导出 + 决策偏好 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={onBack}
            className="text-sm text-slate-400 hover:text-brand transition-colors inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="h-4 w-4" /> 返回编辑
          </button>
          <span className="text-edge">|</span>
          {/* 导出：PNG 图片（整页栅格化）+ 打印为 PDF（浏览器打印对话框，配合打印样式）+ 复制纯文本摘要 */}
          <button
            onClick={exportPng}
            disabled={exporting}
            className="text-sm text-slate-400 hover:text-brand transition-colors inline-flex items-center gap-1.5 no-print disabled:opacity-60"
            title="把整份报告导出成一张 PNG 图片，适合直接发到聊天工具 / 存图留档"
          >
            {exporting
              ? <><Loader2 className="h-4 w-4 animate-spin" /> 生成中…</>
              : <><ImageDown className="h-4 w-4" /> 导出 PNG</>}
          </button>
          <button
            onClick={() => window.print()}
            className="text-sm text-slate-400 hover:text-brand transition-colors inline-flex items-center gap-1.5 no-print"
            title="调起浏览器打印对话框，可另存为 PDF（已隐藏页头页脚与按钮，只打印报告内容）"
          >
            <Printer className="h-4 w-4" /> 打印 / PDF
          </button>
          <button
            onClick={copySummary}
            className="text-sm text-slate-400 hover:text-brand transition-colors inline-flex items-center gap-1.5 no-print"
            title="复制纯文本决策摘要（推荐规格、排名、边际效益与避坑提示）到剪贴板"
          >
            {copied
              ? <><Check className="h-4 w-4 text-emerald-500" /> <span className="text-emerald-500">已复制</span></>
              : <><Copy className="h-4 w-4" /> 复制摘要</>}
          </button>
          {getShareUrl && (
            <button
              onClick={copyShareLink}
              disabled={sharing}
              className="text-sm text-slate-400 hover:text-brand transition-colors inline-flex items-center gap-1.5 no-print disabled:opacity-60"
              title="生成只读分享链接（清单与配置压缩进 URL，不含任何服务器）并复制到剪贴板"
            >
              {shareCopied
                ? <><Check className="h-4 w-4 text-emerald-500" /> <span className="text-emerald-500">链接已复制</span></>
                : <><Share2 className="h-4 w-4" /> {sharing ? '生成中…' : '分享链接'}</>}
            </button>
          )}
        </div>

        {/* 决策偏好切换 */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500">决策偏好：</span>
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
                    ? 'bg-brand/15 text-brand'
                    : 'text-slate-400 hover:text-brand-deep'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {config.preference === 'budget' && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500">预算</span>
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

      {shareTooLong && (
        <div className="rounded-2xl border border-amber-400/40 bg-amber-500/5 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 text-xs text-amber-600 dark:text-amber-400 no-print">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1">
            清单较大，分享链接约 <strong className="tabular">{shareTooLong.len}</strong> 字符，微信 / 邮件等可能自动截断。
            建议回工作台用「<strong>导出备份</strong>」以文件方式分享，或仍复制该链接。
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={forceCopyShareLink}
              className="px-3 py-1.5 rounded-lg bg-amber-500 text-white hover:opacity-90 transition-opacity"
            >
              仍要复制链接
            </button>
            <button
              onClick={() => setShareTooLong(null)}
              className="px-3 py-1.5 rounded-lg border border-edge text-slate-500 hover:text-brand-deep hover:border-brand/50 transition-all"
            >
              关闭
            </button>
          </div>
        </div>
      )}

      {exportError && (
        <div className="rounded-2xl border border-amber-400/40 bg-amber-500/5 px-4 py-3 flex items-center gap-3 text-xs text-amber-600 dark:text-amber-400 no-print">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1">{exportError}</span>
          <button
            onClick={() => setExportError(null)}
            className="px-3 py-1.5 rounded-lg border border-edge text-slate-500 hover:text-brand-deep hover:border-brand/50 transition-all shrink-0"
          >
            知道了
          </button>
        </div>
      )}

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

      {/* ① 一句话结论：不读表格就能拿到的性价比答案 */}
      {oneLiner && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-brand/30 bg-brand/5 px-5 py-4"
        >
          <div className="flex items-center gap-1.5 text-xs font-semibold text-brand mb-1.5">
            <Lightbulb className="h-3.5 w-3.5" /> 一句话结论
          </div>
          <p className="text-sm sm:text-base leading-relaxed text-slate-600">
            本单最划算：<span className="font-bold text-ink">{oneLiner.anchor.fullName}</span>
            ，每{visualUnit}只要 <span className="font-bold text-brand tabular">{fmt.priceUnit(oneLiner.anchor.perUnit)}</span>
            ，比单价最高的「{oneLiner.worst.name}」每{visualUnit}省
            <span className="font-bold text-emerald-500 tabular"> {fmt.priceUnit(oneLiner.savePerUnit)}</span>
            （便宜 {oneLiner.pct.toFixed(0)}%）
            {oneLiner.vsWorst >= 1 && (
              <>，按同样一档的量买能省 <span className="font-bold text-emerald-500 tabular">≈{fmt.yuan(oneLiner.vsWorst)}</span></>
            )}
            。
          </p>
        </motion.div>
      )}

      {/* 冠军推荐 */}
      {best && (
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass rounded-3xl p-6 sm:p-8 relative overflow-hidden"
        >
          <div className="absolute -top-20 -right-20 h-64 w-64 rounded-full bg-brand/10 blur-3xl" />
          <div className="relative">
            <div className="flex items-center gap-2 text-brand text-sm font-semibold mb-3">
              <Trophy className="h-4 w-4" /> 本期最划算
            </div>
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
              <div className="flex-1">
                <h2 className="text-3xl sm:text-5xl font-bold tracking-tight">{best.name}</h2>
                <div className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
                  <div>
                    <div className="text-sm text-slate-400 mb-0.5">每{displayUnit(best.unit)}单价</div>
                    <div className="text-2xl font-bold text-brand tabular">
                      <CountUp value={displayUnitPrice(best.unitPrice, best.unit)} format={fmt.priceUnit} />
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-400 mb-0.5">每{packWord(best.packs, best.packUnit)}价格</div>
                    <div className="text-2xl font-bold tabular">
                      <CountUp value={best.packPrice} format={fmt.yuan} />
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-400 mb-0.5">综合得分</div>
                    <div className="text-2xl font-bold tabular">
                      <CountUp value={best.score} format={(n) => n.toFixed(1)} />
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-400 mb-0.5">总价 / 总量</div>
                    <div className="text-2xl font-bold tabular">
                      <CountUp value={best.price} format={fmt.yuan} />
                      <span className="text-sm text-slate-400 font-normal ml-2">
                        {fmt.num(displayQuantity(best.totalQuantity, best.unit))}{displayUnit(best.unit)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 价格走势：仅当该规格留下过 ≥2 次价格记录时出现 */}
                {bestTrend && (
                  <div
                    className={`mt-4 inline-flex items-start gap-1.5 rounded-xl border px-3 py-1.5 text-xs leading-relaxed ${
                      bestTrend.direction === 'down'
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : bestTrend.direction === 'up'
                          ? 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                          : 'border-edge bg-panel/60 text-slate-500'
                    }`}
                  >
                    <TrendIcon className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>
                      价格
                      {bestTrend.direction === 'up' ? '上涨' : bestTrend.direction === 'down' ? '下降' : '持平'}
                      {bestTrend.direction !== 'flat' && ` ${Math.abs(bestTrend.deltaPct).toFixed(1)}%`}
                      ：{fmt.yuan(bestTrend.first)} → {fmt.yuan(bestTrend.last)}
                      <span className="text-slate-400">
                        （{bestTrend.points.length} 次记录 · {fmtPointDay(bestTrend.points[0].t)} 起）
                      </span>
                    </span>
                  </div>
                )}

                {/* 数据新鲜度：把"结论基于何时录的价格"摆到冠军卡片上。
                    只写不读的时间戳会让结论看着永远新鲜，过期时必须显式标黄。 */}
                {bestPriceAt && (
                  <div
                    className={`mt-3 flex items-start gap-1.5 rounded-xl border px-3 py-1.5 text-xs leading-relaxed ${
                      bestStale
                        ? 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                        : 'border-edge bg-panel/60 text-slate-500'
                    }`}
                  >
                    {bestStale
                      ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      : <RefreshCw className="h-3.5 w-3.5 shrink-0 mt-0.5" />}
                    <span>
                      冠军价格记录于 {fmt.ago(bestPriceAt)}
                      {bestStale && (
                        <span className="font-medium">
                          （已超过 {STALE_DAYS} 天未更新，结论可能过期，建议重新核对价格）
                        </span>
                      )}
                    </span>
                  </div>
                )}
              </div>

              {/* 推荐理由 */}
              <div className="lg:w-96 rounded-2xl bg-brand-soft/60 border border-edge p-5">
                <div className="text-xs font-semibold text-slate-600 mb-3 flex items-center gap-1.5">
                  <Lightbulb className="h-3.5 w-3.5 text-brand" /> 推荐理由
                </div>
                <ul className="space-y-2">
                  {reasons.map((r, i) => (
                    <li key={i} className="text-xs text-slate-400 leading-relaxed flex gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-brand shrink-0 mt-0.5" />
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </motion.section>
      )}

      {/* ② 主视觉：围绕「每单位单价」的四种看法，同一份数据同一把标尺 */}
      {specRows.length >= 2 && (
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass rounded-2xl p-6"
        >
          <h3 className="text-lg font-bold tracking-tight mb-1 flex items-center gap-2">
            <Scale className="h-5 w-5 text-brand" /> 性价比主视觉
          </h3>
          {/* 视图切换：四种编码方式都保留，后续按实际效果做减法 */}
          <div className="flex items-center gap-2 flex-wrap mb-3 mt-3 text-xs">
            <span className="text-slate-500">看法：</span>
            {VISUAL_OPTIONS.map((opt) => (
              <button
                key={opt.k}
                onClick={() => setVisual(opt.k)}
                className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                  visual === opt.k
                    ? 'bg-brand/15 text-brand border border-brand/50'
                    : 'text-slate-400 hover:text-brand-deep border border-edge'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500 mb-4">{activeVisual.hint}</p>

          <div className="rounded-xl border border-edge bg-brand-soft/20 p-4">
            <MainVisual
              kind={visual}
              rows={specRows}
              unitLabel={visualUnit}
              anchorId={visualAnchorId}
              theme={chartTheme}
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ background: chartTheme.series.unitPrice }} />
              推荐规格
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ background: neutralBar(chartTheme.dark) }} />
              其余规格
            </span>
            {visual === 'quadrant' && (
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-3 h-3 rounded-full" style={{ background: chartTheme.series.drop }} />
                最划算点
              </span>
            )}
            <span className="text-slate-400 dark:text-slate-500">· 已合并同价同规格的口味变体 · 按总量升序 = 升档顺序</span>
          </div>
        </motion.section>
      )}

      {/* ③ 升档值不值：一档一张卡，把「多花多少钱、多拿多少量、净省多少」说清 */}
      {margins.length > 0 && (
        <section className="glass rounded-2xl p-6">
          <h3 className="text-lg font-bold tracking-tight mb-1 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-brand" /> 升档值不值
          </h3>
          <p className="text-xs text-slate-500 mb-4">
            按总量从小到大逐档比较：<b className="text-slate-600">净省（白赚）</b> 是「这一档多拿的量，按上一档单价折算成钱，减去你多花的钱」——
            为正说明加量把多花的钱赚回来了，越大越值得升。
          </p>

          <div className="space-y-3">
            {margins.map((m, i) => (
              <UpgradeCard key={`${m.fromId}-${m.toId}-${i}`} m={m} />
            ))}
          </div>

          {/* 逐档明细表：结论已在卡片里，明细默认收起 */}
          <button
            onClick={() => setShowMarginTable((v) => !v)}
            className="mt-4 text-xs text-slate-500 hover:text-brand transition-colors inline-flex items-center gap-1.5 no-print"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showMarginTable ? 'rotate-180' : ''}`} />
            {showMarginTable ? '收起逐档明细' : `展开逐档明细（${margins.length} 档）`}
          </button>

          {showMarginTable && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs min-w-[520px]">
                <thead>
                  <tr className="border-b border-edge text-left text-sm text-slate-500">
                    <th className="px-2 py-2 font-medium">规格</th>
                    <th className="px-2 py-2 font-medium text-right">多花</th>
                    <th className="px-2 py-2 font-medium text-right">多得</th>
                    <th className="px-2 py-2 font-medium text-right">单价变化</th>
                    <th className="px-2 py-2 font-medium text-right">净省</th>
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
                        <td className="px-2 py-2.5 text-right tabular text-brand-deep">{fmt.num(displayQuantity(m.extraQuantity, m.unit))}{displayUnit(m.unit)}</td>
                        <td className={`px-2 py-2.5 text-right tabular font-semibold ${m.unitPriceDropPct > 0 ? 'text-brand' : m.unitPriceDropPct < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                          {m.unitPriceDropPct > 0 ? '-' : m.unitPriceDropPct < 0 ? '+' : ''}{Math.abs(m.unitPriceDropPct).toFixed(1)}%
                        </td>
                        <td className={`px-2 py-2.5 text-right tabular font-semibold ${m.netSaving >= 0 ? 'text-emerald-500' : 'text-amber-500'}`}>
                          {m.netSaving >= 0 ? '+' : '−'}{fmt.yuan(Math.abs(m.netSaving))}
                        </td>
                        <td className="px-2 py-2.5 text-right tabular font-semibold text-brand">
                          {perExtraYuan > 0 ? `${fmt.num(displayQuantity(perExtraYuan, m.unit))}${displayUnit(m.unit)}` : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {/* 图例 */}
              <div className="mt-3 flex flex-wrap gap-3 text-sm text-slate-500">
                {Object.entries(GRADE_STYLE).map(([k, v]) => (
                  <span key={k} className="inline-flex items-center gap-1">
                    <span className={`inline-block w-2.5 h-2.5 rounded-sm ${v.dot}`} />
                    {v.label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ④ 避坑提示 */}
      {warnings.length > 0 && (
        <section className="rounded-2xl border border-amber-400/30 bg-amber-400/5 p-5">
          <h3 className="text-sm font-bold tracking-tight mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" /> 避坑提示
          </h3>
          <ul className="space-y-2">
            {warnings.map((w, i) => (
              <li key={i} className="flex gap-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-slate-600 leading-relaxed">{w}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ⑤ 明细（默认收起）：完整排名表，支持簇化简 / 全量切换与分组折叠 */}
      <section className="glass rounded-2xl p-6">
        <button
          onClick={() => setShowDetail((v) => !v)}
          className="w-full flex items-center justify-between gap-3 text-left no-print"
        >
          <span className="text-lg font-bold tracking-tight flex items-center gap-2">
            <List className="h-5 w-5 text-brand" /> 完整排名
            <span className="text-xs font-normal text-slate-500">共 {items.length} 项规格</span>
          </span>
          <span className="text-xs text-slate-500 inline-flex items-center gap-1.5 shrink-0">
            {showDetail ? '收起明细' : '查看明细'}
            <ChevronDown className={`h-4 w-4 transition-transform ${showDetail ? 'rotate-180' : ''}`} />
          </span>
        </button>

        {showDetail && (
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h4 className="text-sm font-bold tracking-tight">
                {view === 'cluster' ? '决策排名（已按规格聚合）' : '全部规格'}
              </h4>
              {hasVariants && (
                <div className="flex rounded-lg border border-edge overflow-hidden text-xs">
                  <button
                    onClick={() => switchView('cluster')}
                    className={`px-3 py-1.5 font-medium flex items-center gap-1.5 transition-colors ${
                      view === 'cluster' ? 'bg-brand/15 text-brand' : 'text-slate-400 hover:text-brand-deep'
                    }`}
                  >
                    <Layers className="h-3.5 w-3.5" /> 简化视图
                  </button>
                  <button
                    onClick={() => switchView('full')}
                    className={`px-3 py-1.5 font-medium flex items-center gap-1.5 transition-colors ${
                      view === 'full' ? 'bg-brand/15 text-brand' : 'text-slate-400 hover:text-brand-deep'
                    }`}
                  >
                    <List className="h-3.5 w-3.5" /> 全部 {items.length} 项
                  </button>
                </div>
              )}
            </div>

            {view === 'cluster' && decisionUnits ? (
              <>
                <p className="text-xs text-slate-500">
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
                              ? 'bg-brand/15 text-brand border border-brand/50'
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
                        <th className="px-2 py-2 font-medium text-right">每{displayUnit(items[0]?.unit ?? '')}</th>
                        <th className="px-2 py-2 font-medium text-right">每{listPackWord(items)}</th>
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
          </div>
        )}
      </section>
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
        cluster.isBest ? 'ring-1 ring-brand/50 shadow-glow' : ''
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
              <span className="text-sm px-1.5 py-0.5 rounded bg-brand/15 text-brand font-semibold">
                推荐
              </span>
            )}
            {hasFlavors && (
              <span className="text-sm px-1.5 py-0.5 rounded bg-slate-500/15 text-slate-500 dark:text-slate-300">
                {cluster.members.length} 种{flavorLabel}
              </span>
            )}
          </div>
          <div className="text-sm text-slate-500 mt-0.5 tabular">
            {cluster.priceSpread > 0
              ? `${fmt.yuan(cluster.minPrice)} ~ ${fmt.yuan(cluster.maxPrice)}`
              : `${fmt.yuan(active.price)}`}{' '}
            · 共 {fmt.num(displayQuantity(cluster.quantity * cluster.packs, cluster.unit))}{displayUnit(cluster.unit)}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-base font-bold tabular">
            <span className="text-brand">{fmt.priceUnit(displayUnitPrice(cluster.repUnitPrice, cluster.unit))}</span>
            <span className="text-sm text-slate-500 font-normal"> /{displayUnit(cluster.unit)}</span>
          </div>
          <div className="text-sm text-slate-500">每{packWord(cluster.packs, cluster.packUnit)} {fmt.yuan(active.price / Math.max(1, cluster.packs))}</div>
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
                    ? 'bg-brand/20 text-brand border border-brand/50'
                    : 'bg-brand-soft/50 text-slate-400 border border-edge hover:text-brand-deep hover:border-brand/40'
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
              {fmt.yuan(active.price)}，每{displayUnit(active.unit)} {fmt.priceUnit(displayUnitPrice(active.unitPrice, active.unit))}
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
                className={`h-3.5 w-3.5 text-brand transition-transform duration-200 ${
                  isCollapsed ? '-rotate-90' : ''
                }`}
              />
              <span className="text-brand">{groupKey}</span>
              <span className="text-slate-500 font-normal">（{groupItems.length} 个规格）</span>
            </div>
          </td>
        </tr>
      )}

      {/* 数据行：折叠时隐藏，分组内排名按 allItems 中的位置；逐行错峰淡入 */}
      {!isCollapsed &&
        groupItems.map((item, rowIdx) => {
          // 用全局排名（item.rank 已按得分排序），前三名用奖牌图标
          const idx = allItems.findIndex((x) => x.id === item.id)
          const RankIcon = RANK_ICON[idx]
          const { flavor } = parseFlavor(item.name)
          const flavorBg = flavor ? flavorColorMap.get(flavor) ?? '' : ''
          return (
            <motion.tr
              key={item.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2, delay: Math.min(rowIdx * 0.04, 0.3) }}
              className={`border-b border-edge/50 hover:bg-brand-soft/30 transition-colors ${
                item.isBest ? 'bg-brand/5' : ''
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
                    <span className="px-1.5 py-0.5 rounded bg-brand/15 text-brand text-xs font-semibold">推荐</span>
                  )}
                </div>
              </td>
              <td className="px-2 py-2.5 text-right tabular text-brand-deep">{fmt.yuan(item.price)}</td>
              <td className="px-2 py-2.5 text-right tabular text-brand-deep">{fmt.num(displayQuantity(item.totalQuantity, item.unit))}{displayUnit(item.unit)}</td>
              <td className="px-2 py-2.5 text-right tabular font-semibold text-brand">{fmt.priceUnit(displayUnitPrice(item.unitPrice, item.unit))}</td>
              <td className="px-2 py-2.5 text-right tabular text-slate-500 dark:text-slate-300">{fmt.yuan(item.packPrice)}</td>
            </motion.tr>
          )
        })}
    </>
  )
}