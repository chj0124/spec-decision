import { useEffect, useMemo, useRef, useState } from 'react'
import type { ComputedSku, DecisionResult, DecisionConfig, Preference, SkuCluster, MarginInsight, WarningPair } from '../lib/types'
import { fmt, isStale, STALE_DAYS, mergeVariantSkus, parseFlavor, inferFlavorLabel, priceTrend, fmtPointDay, displayUnit, displayQuantity, displayUnitPrice, marginAnalysis } from '../lib/engine'
import {
  shortSpec, packWord, listPackWord, splitWarnText, wrapCjk,
  buildPreferenceHint, buildSummaryText,
  groupComputedSkus, deriveGroupOptions, deriveFlavorColorMap,
  deriveSpecRows, deriveVisualAnchorId, deriveOneLiner,
} from '../lib/view-model'
import type { FullGroupBy, SpecRow } from '../lib/view-model'
import { palette } from '../lib/palette'
import {
  Trophy, ArrowLeft, AlertTriangle, TrendingDown, TrendingUp, CheckCircle2,
  Crown, Medal, Award, Lightbulb, Scale, Layers, List, ChevronDown, RefreshCw,
  Printer, Copy, Check, Share2, Minus, ImageDown, Loader2, FilterX,
} from 'lucide-react'
import { motion, AnimatePresence, animate } from 'framer-motion'
import { useChartTheme, type ChartTheme } from '../lib/useChartTheme'
import { exportNodeToPng, buildReportFileName, EXPORT_BG } from '../lib/exportImage'
import {
  Bar, BarChart, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ComposedChart, Line, Cell, ReferenceLine, ReferenceDot, Customized,
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

/** 各决策偏好的静态说明（悬停在切换按钮上时显示） */
const PREFERENCE_HINT: Record<Preference, string> = {
  value: '只看每单位单价，最便宜的排第 1，参数不参与排名',
  score: '价格分 × 价格权重 + 各参数维度分 × 参数权重，加权总分高的排第 1',
  budget: '先过滤掉总价超预算的规格，再按综合得分排名',
}

/**
 * 因超预算被排除的规格清单：逐条列出规格名、总价与超出预算的金额。
 * 预算偏好会把超预算的规格从排名里过滤掉，如果不显式交代，它们就等于无声消失，
 * 用户无从判断"是数据没识别到"还是"被预算规则筛掉了"。
 */
function BudgetExcludedList({ items, budget }: { items: ComputedSku[]; budget: number }) {
  return (
    <ul aria-label="因超预算被排除的规格" className="space-y-1.5">
      {items.map((it) => (
        <li key={it.id} className="flex items-baseline justify-between gap-3 text-xs">
          <span className="text-slate-600 truncate">{it.name}</span>
          <span className="shrink-0 tabular">
            <span className="text-slate-500">{fmt.yuan(it.price)}</span>
            <span className="text-amber-500 ml-1.5">超 {fmt.yuan(it.price - budget)}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

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

/* ============ 主视觉：围绕「每单位单价」这一个标尺的四种看法 ============ */

/** 主视觉视图类型（四种候选，供减法筛选） */
type VisualKind = 'price' | 'perYuan' | 'quadrant' | 'savings'

/** 非冠军柱的中性色（亮 / 暗各一） */
const neutralBar = (dark: boolean) => (dark ? '#52525f' : '#cdc7b8')

/* ============ 避坑对照的图形标注：行高亮 + 差值段 + 右缘括线 三合一 ============ */

/** 图例里的小标记：淡黄行底 + 粗黄差值段 + 右缘括线，与图上的三合一标注一致 */
function WarnLegendMark({ color }: { color: string }) {
  return (
    <svg width="26" height="12" viewBox="0 0 26 12" className="inline-block align-middle">
      {/* 行高亮 */}
      <rect x="0" y="0" width="20" height="12" rx="2" fill={color} opacity={0.16} />
      {/* 差值段 */}
      <rect x="11" y="4.5" width="9" height="3" rx="1.5" fill={color} />
      {/* 右缘括线 */}
      <path d="M21 2 H24 V10 H21" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

/** Customized 覆盖层能拿到的 recharts 图表内部状态（只声明用得到的字段） */
interface WarnOverlayProps {
  warnRows?: SpecRow[]
  warnKey?: keyof Pick<SpecRow, 'perUnit' | 'per100' | 'savings'>
  warnPairs?: WarningPair[]
  warnTheme?: ChartTheme
  /** 图右侧为避坑标注预留的宽度（= BarChart 的 margin.right），用于给编号旁的注文折行、防裁切 */
  warnRightRoom?: number
  xAxisMap?: Record<string, { scale?: (v: number) => number }>
  yAxisMap?: Record<string, {
    scale?: (v: number | string) => number
    bandSize?: number
    /** 分类轴重名时 recharts 保留的原始名称域（此时 scale 的 domain 已换成序号域） */
    duplicateDomain?: Array<string | number>
  }>
  offset?: { top: number; left: number; width: number; height: number }
}

/**
 * 避坑对照的图形标注（替代原先那条横穿整张图的长斜虚线）。
 * 借 recharts 的 <Customized> 拿到图表内部坐标（xAxisMap / yAxisMap 的 scale + offset），
 * 于是能精确落到每条横条的柱端，把"哪两条被对照"画得干净、不穿越其它柱子。
 * 三合一画法：被对照的两行铺淡黄底（行高亮），较贵那条上标出多出来的一截（差值段），
 * 右缘再用括线把两条收在一起、挂上编号（右缘括线），编号旁直接写清这条避坑提示。
 */
function WarnOverlay({
  warnRows = [],
  warnKey = 'perUnit',
  warnPairs = [],
  warnTheme,
  warnRightRoom = 120,
  xAxisMap,
  yAxisMap,
  offset,
}: WarnOverlayProps) {
  const xScale = xAxisMap ? Object.values(xAxisMap)[0]?.scale : undefined
  const yAxis = yAxisMap ? Object.values(yAxisMap)[0] : undefined
  const yScale = yAxis?.scale
  const bandSize = yAxis?.bandSize ?? 36
  if (!warnTheme || !offset || !xScale || !yScale || warnPairs.length === 0) return <g />

  // 规格名一旦重名（示例数据里「鸡肉·10kg」就会出现三次），recharts 的 allowDuplicatedCategory
  // 会让分类轴保留原名 domain 到 duplicateDomain，而把 scale 的 domain 换成序号域 [0..n)。
  // 此时按名称取坐标得到 undefined，加减后就是 NaN，写进 SVG 属性会被浏览器判为非法而报错。
  // 所以要么用名称、要么用行下标，且一律先校验坐标有限再画。
  const indexDomain = Array.isArray(yAxis?.duplicateDomain) && yAxis.duplicateDomain.length > 0
  /** 行所在条带的顶边 y；拿不到有限值时返回 null，宁可少画一条也不能把 NaN 写进 SVG */
  const bandTop = (row: SpecRow, index: number) => {
    const top = yScale(indexDomain ? index : row.name)
    return typeof top === 'number' && Number.isFinite(top) ? top : null
  }

  const amber = warnTheme.series.margin
  const plotLeft = offset.left
  const plotRight = offset.left + offset.width
  const maxTip = warnRows.reduce((m, r) => {
    const v = xScale(r[warnKey])
    return Number.isFinite(v) ? Math.max(m, v) : m
  }, 0)
  // 括线 / 编号一律放"所有柱子右侧"的空白里；柱子太靠右时退到右边距内
  const spineX = Math.min(Math.max(maxTip + 44, plotRight - 6), plotRight + 56)

  const badge = (cx: number, cy: number, text: string) => (
    <g>
      <circle cx={cx} cy={cy} r={9} fill={amber} stroke={warnTheme.label.stroke} strokeWidth={2} />
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fill="#ffffff" fontSize={11} fontWeight={700}>
        {text}
      </text>
    </g>
  )

  return (
    <g>
      {warnPairs.map((p, i) => {
        const ai = warnRows.findIndex((r) => r.id === p.fromId) // 被对照里较贵的那条
        const bi = warnRows.findIndex((r) => r.id === p.toId) // 较便宜的那条
        if (ai < 0 || bi < 0) return null
        const a = warnRows[ai]
        const b = warnRows[bi]
        const topA = bandTop(a, ai)
        const topB = bandTop(b, bi)
        const xA = xScale(a[warnKey])
        const xB = xScale(b[warnKey])
        if (topA === null || topB === null || !Number.isFinite(xA) || !Number.isFinite(xB)) return null
        const yA = topA + bandSize / 2
        const yB = topB + bandSize / 2
        const lo = Math.min(xA, xB)
        const hi = Math.max(xA, xB)
        const midY = (yA + yB) / 2
        const no = String(i + 1)
        // 多组对照各自占一条"竖向泳道"，编号也顺次右移，避免几组叠在同一竖线上看着像连成一条
        const laneX = spineX + i * 22
        const badgeX = laneX + 14
        // 编号旁的注文：粗体结论 + 灰色细节，按右侧留白折行（svg 右缘 ≈ 绘图区右缘 + margin.right）
        const { lead, detail } = splitWarnText(p.text)
        const noteFontSize = 10.5
        const noteX = badgeX + 13
        const noteRightEdge = plotRight + warnRightRoom
        const maxEm = Math.max(6, (noteRightEdge - noteX - 2) / noteFontSize)
        const leadLines = wrapCjk(lead, maxEm)
        const detailLines = detail ? wrapCjk(detail, maxEm) : []
        const noteLineHeight = 14
        const noteTotalH = (leadLines.length + detailLines.length) * noteLineHeight
        const noteStartY = midY - noteTotalH / 2 + noteLineHeight / 2

        return (
          <g key={`warn-${i}`}>
            {/* 行高亮：被对照的两行整行铺一层淡黄底 */}
            <rect x={plotLeft} y={topA} width={offset.width} height={bandSize} rx={8} fill={amber} fillOpacity={0.16} />
            <rect x={plotLeft} y={topB} width={offset.width} height={bandSize} rx={8} fill={amber} fillOpacity={0.16} />
            {/* 差值段：便宜那条的柱端拉一条竖直虚线过去，充当"基准线" */}
            <line x1={xB} y1={yB} x2={xB} y2={yA} stroke={amber} strokeWidth={1} strokeDasharray="3 3" opacity={0.6} />
            {/* 贵那条上"多出来的一截"，并标清贵了多少 */}
            <line x1={lo} y1={yA} x2={hi} y2={yA} stroke={amber} strokeWidth={6} strokeLinecap="round" />
            <circle cx={hi} cy={yA} r={4} fill={amber} />
            <text x={(lo + hi) / 2} y={yA - 13} textAnchor="middle" fill={amber} fontSize={11} fontWeight={700}>
              {`贵 ${p.pct}%`}
            </text>
            {/* 右缘括线：把两条横条"收"在一起 */}
            <path
              d={`M ${laneX - 11} ${yA} H ${laneX} V ${yB} H ${laneX - 11}`}
              fill="none"
              stroke={amber}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {badge(badgeX, midY, no)}
            {/* 编号旁的注文：这条避坑提示直接标在图上，不必再去图下找编号 */}
            <text x={noteX} y={noteStartY} fontSize={noteFontSize} dominantBaseline="central">
              {leadLines.map((l, j) => (
                <tspan key={`wl-${j}`} x={noteX} dy={j === 0 ? 0 : noteLineHeight} fill={amber} fontWeight={700}>
                  {l}
                </tspan>
              ))}
              {detailLines.map((l, j) => (
                <tspan key={`wd-${j}`} x={noteX} dy={noteLineHeight} fill={warnTheme.tick}>
                  {l}
                </tspan>
              ))}
            </text>
          </g>
        )
      })}
    </g>
  )
}

/**
 * 性价比主视觉：同一份数据四种编码方式，都只围绕「每单位单价」。
 * - price    每单位单价横条（越短越省 + 平均线）
 * - perYuan  每 100 元买到多少（越长越划算）
 * - quadrant 性价比象限（总量 × 单价，连线即升档路径）
 * - savings  相对最贵档省下多少钱（绝对金额）
 * 冠军条统一高亮，其余中性色。
 */
function MainVisual({
  kind, rows, unitLabel, anchorId, theme, warningPairs,
}: {
  kind: VisualKind
  rows: SpecRow[]
  unitLabel: string
  anchorId: string
  theme: ChartTheme
  /** 需要连线对照的避坑提示（带两条规格 id），在主视觉里标出被对照的两条横条 */
  warningPairs: WarningPair[]
}) {
  // 跟踪图表容器宽度：右侧要给「括线 + 编号 + 编号旁的注文」留白，窄屏少留、靠折行兜底
  const boxRef = useRef<HTMLDivElement>(null)
  const [boxWidth, setBoxWidth] = useState(0)
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver((es) => setBoxWidth(es[0].contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
    // kind 切换会换一个容器 div（象限图 / 横条图两个分支），重新挂一次观察器
  }, [kind])

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
  // 右侧留白：括线 + 编号 + 编号旁的避坑注文；窄屏（<640px）少留一点，注文靠折行兜底
  const warnRightRoom = warningPairs.length
    ? (boxWidth > 0 && boxWidth < 640 ? 132 : 205) + (warningPairs.length - 1) * 22
    : 72

  return (
    <div ref={boxRef} style={{ height: chartHeight }}>
      <ResponsiveContainer width="100%" height="100%">
        {/* 单价图顶上加高：平均线标签 position:'top' 画在绘图区上方，留白不够会被 SVG 边界裁掉 */}
        <BarChart layout="vertical" data={data} margin={{ top: kind === 'price' ? 26 : 8, right: warnRightRoom, bottom: 24, left: 4 }} barCategoryGap={12}>
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
          {/* 避坑对照：行高亮 + 差值段 + 右缘括线，把被对照的两条横条标出来 */}
          <Customized
            component={WarnOverlay}
            warnRows={data}
            warnKey={dataKey}
            warnPairs={warningPairs}
            warnTheme={theme}
            warnRightRoom={warnRightRoom}
          />
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

/* ============ 预算输入框：字符串草稿 + 数字解析，专治「输到一半被打断」 ============ */
function BudgetInput({
  value,
  onChange,
  className,
}: {
  value?: number
  onChange: (v: number | undefined) => void
  className?: string
}) {
  // 不把数字直接回写进 input.value：受控的 type="number" 每次回写都会把光标打到开头，
  // 后续按键被插到最前面（实测输 19.9 会变成 919）；而 "" / "19." 这类中间态还会被
  // 浏览器直接清空。改成 text + inputMode="decimal" 并存字符串草稿，按键就原样留在框里。
  const [draft, setDraft] = useState(value === undefined ? '' : String(value))
  const [focused, setFocused] = useState(false)
  // 外部改动（切偏好 / 分享导入 / 换工作区）时同步；正在输入时不打扰
  useEffect(() => {
    if (!focused) setDraft(value === undefined ? '' : String(value))
  }, [value, focused])
  const apply = (raw: string) => {
    const t = raw.trim()
    if (t === '') {
      onChange(undefined)
      return
    }
    const n = Number(t)
    // 只认非负有限数：NaN / 负号 / 多个小数点都按「没填预算」处理，避免把 NaN 传下去
    onChange(Number.isFinite(n) && n >= 0 ? n : undefined)
  }
  // 改成 text 后字母也进得来，这里挡掉：只留数字与小数点，且最多一个小数点。
  // 这样用户按错键时框里不会留一个解析不了的 "12abc"，也不用等失焦才清理。
  const sanitize = (raw: string) => {
    const cleaned = raw.replace(/[^\d.]/g, '')
    const dot = cleaned.indexOf('.')
    return dot === -1 ? cleaned : cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '')
  }
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label="预算"
      value={draft}
      onFocus={() => setFocused(true)}
      // 失焦即收尾：按已提交的值回显，清掉 "12." 这类没收尾的残留
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        const next = sanitize(e.target.value)
        setDraft(next)
        apply(next)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      placeholder="¥"
      className={className}
    />
  )
}

export default function Report({ result, config, unitWarning, onBack, onPreferenceChange, onBudgetChange, getShareUrl }: Props) {
  const { items, best, margins, warningPairs, warningNotes, reasons, clusters, hasVariants } = result
  const chartTheme = useChartTheme()
  // 决策偏好动态提示：说清当前数据下各偏好的排名差异（为什么点了没变化 / 权重侧重在哪）
  const preferenceHint = buildPreferenceHint(items, config, config.preference)
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

  // 组件内所有「延时恢复文案 / 延时关菜单」的定时器统一登记，卸载时一次性清理，
  // 避免卸载后回调触发 setState 造成 "setState on unmounted component" 告警与内存泄漏。
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  const schedule = (fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timersRef.current.delete(id)
      fn()
    }, ms)
    timersRef.current.add(id)
  }
  useEffect(() => () => {
    timersRef.current.forEach((id) => clearTimeout(id))
    timersRef.current.clear()
  }, [])

  // 复制决策摘要到剪贴板（2 秒后恢复按钮文案）
  const [copied, setCopied] = useState(false)
  // 导出 / 分享下拉菜单开关
  const [shareMenuOpen, setShareMenuOpen] = useState(false)
  const copySummary = async () => {
    const text = buildSummaryText(result, config)
    if (!text) return
    await writeClipboard(text)
    setCopied(true)
    schedule(() => setCopied(false), 2000)
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
      schedule(() => setShareCopied(false), 2500)
    } finally {
      setSharing(false)
    }
  }

  const forceCopyShareLink = async () => {
    if (!shareTooLong) return
    await writeClipboard(shareTooLong.url)
    setShareTooLong(null)
    setShareCopied(true)
    schedule(() => setShareCopied(false), 2500)
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
  // 升档基准档：null = 默认逐档相邻对比；选中某个规格 id 后，所有更大档都直接与它比
  const [marginBaseId, setMarginBaseId] = useState<string | null>(null)
  // 逐档明细表默认收起：升档卡片已把结论说完，明细按需展开
  const [showMarginTable, setShowMarginTable] = useState(false)
  // 完整排名表默认收起：报告先给结论，明细按需展开
  const [showDetail, setShowDetail] = useState(false)

  // 升档基准档候选：与 marginAnalysis 同源（同价同规格已合并、按总量升序）
  const marginTiers = useMemo(
    () => mergeVariantSkus(items).sort((a, b) => a.totalQuantity - b.totalQuantity),
    [items],
  )
  // 当前基准下的升档结论：默认逐档相邻对比；选了基准档则所有更大档与它直接比
  const sectionMargins = useMemo(
    () => marginAnalysis(items, marginBaseId ?? undefined),
    [items, marginBaseId],
  )
  // 数据更新后选中的基准档可能已不存在（被删除 / 识别换了一批），自动退回默认逐档对比
  useEffect(() => {
    if (marginBaseId && !marginTiers.some((t) => t.id === marginBaseId)) setMarginBaseId(null)
  }, [marginTiers, marginBaseId])

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
  const flavorColorMap = deriveFlavorColorMap(items, palette.flavor)
  // 分组维度候选：过滤掉无区分意义的（所有 SKU 值相同 / 每组仅1项）
  const groupOptions = deriveGroupOptions(items, flavorLabel)

  // 区分两种空态：真没数据 vs 预算偏好下全部规格超预算被过滤
  const budgetEmpty = items.length === 0 && config.preference === 'budget' && result.budgetExcludedItems.length > 0

  // 空态不再整页 return：那样会把上方工具条连同预算输入框一起卸载，用户输到一半的预算
  // 会丢焦点、后续按键全部丢失（表现为"只能填进一位数"）。这里只当正文块渲染，
  // 工具条与预算输入框始终挂载，把预算调大即可自愈。
  const emptyState = (
    <div className="glass rounded-2xl p-12 text-center space-y-4">
      <Scale className="h-12 w-12 mx-auto text-slate-600" />
      {budgetEmpty ? (
        <>
          <p className="text-slate-400">
            预算 <span className="text-brand font-semibold">{fmt.yuan(config.budget ?? 0)}</span> 内没有可用规格
            （{result.budgetExcludedItems.length} 个规格全部超出预算）。
          </p>
          {/* 空态也要交代"被排除了哪些"，否则用户只知道数量、不知道是谁 */}
          {typeof config.budget === 'number' && (
            <div className="max-w-sm mx-auto text-left rounded-xl border border-edge/60 px-3 py-2.5">
              <BudgetExcludedList items={result.budgetExcludedItems} budget={config.budget} />
            </div>
          )}
          <p className="text-sm text-slate-500 -mt-2">
            在上方把预算调大，或切换为「性价比优先 / 综合得分优先」即可继续看报告。
          </p>
        </>
      ) : (
        <p className="text-slate-400">还没有可对比的规格，先回工作台填写。</p>
      )}
      <button
        onClick={onBack}
        className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-500 border border-edge hover:text-brand-deep hover:border-brand/40 transition-all inline-flex items-center gap-2"
      >
        <ArrowLeft className="h-4 w-4" /> {budgetEmpty ? '返回调整' : '返回工作台'}
      </button>
    </div>
  )

  // 决策单元：簇视图按簇，全量视图按单个规格
  const decisionUnits = view === 'cluster' ? clusters : null

  // 主视觉数据：先合并「同价同规格」的口味变体，再统一换算到展示单位（ml→L），
  // 让「每单位单价」成为全场唯一标尺。省下金额 = 相比全场最贵单价、按本档总量折算。
  const specRows: SpecRow[] = deriveSpecRows(items)
  // 展示单位标签（L / kg / 件…）：取列表里实际出现的单位换算结果
  const visualUnit = displayUnit(items[0]?.unit ?? '')
  // 高亮锚点：优先冠军规格；万一它被合并进同价变体，就退而选单价最低的那条。
  // 预算偏好下可能一条都不剩（items 为空），此时给空串兜底——空态不渲染主视觉，
  // 但这里在 return 之前求值，不给兜底会直接抛错把整个报告页打崩。
  const visualAnchorId = deriveVisualAnchorId(specRows, best?.id)

  // 一句话结论：把"最划算"折算成「每单位省了多少钱 + 便宜百分之几 + 等量能省多少」，
  // 不读表格也能直接拿到性价比结论。
  const oneLiner = deriveOneLiner(specRows, visualAnchorId)

  // 主视觉候选（四种编码方式都做出来，后续按效果做减法）
  const VISUAL_OPTIONS: Array<{ k: VisualKind; label: string; hint: string }> = [
    { k: 'price', label: '每单位单价', hint: `横条越短越省：同一标尺下每${visualUnit}要花多少钱，虚线是全场平均价。` },
    { k: 'perYuan', label: '每元买到多少', hint: `横条越长越划算：同样 100 元，这一档能买到多少${visualUnit}。` },
    { k: 'quadrant', label: '性价比象限', hint: '越靠右下越好：总量更大（右）、每单位更便宜（下）；连线即逐档升档路径。' },
    { k: 'savings', label: '省下多少钱', hint: '相比全场最贵单价、按本档总量折算，选这一档实际省下的金额（元）。' },
  ]
  const activeVisual = VISUAL_OPTIONS.find((o) => o.k === visual) ?? VISUAL_OPTIONS[0]
  // 图注：把「这张图怎么读」压成一句话，紧跟在图下的避坑注释之后
  const figureNote =
    visual === 'quadrant'
      ? '横轴是总量、纵轴是单位成本，越靠左下越划算，连线即逐档升档路径。'
      : warningPairs.length > 0
        ? '横条越长代表单价越高。铺了淡黄底、画了差值段和右缘括线的两行正是被对照的规格，编号旁的注文即对应的避坑提示。'
        : '横条越长代表单价越高，虚线是全场平均价。'

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
          {/* 导出 / 分享：四个动作收进一个下拉菜单，工具栏只留一个入口 */}
          <div className="relative no-print">
            <button
              onClick={() => setShareMenuOpen((v) => !v)}
              className="text-sm text-slate-400 hover:text-brand transition-colors inline-flex items-center gap-1.5"
              title="导出图片 / 打印 PDF / 复制文字摘要 / 生成分享链接"
            >
              {exporting || sharing
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Share2 className="h-4 w-4" />}
              {exporting ? '生成中…' : sharing ? '生成中…' : '导出 / 分享'}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${shareMenuOpen ? 'rotate-180' : ''}`} />
            </button>
            {shareMenuOpen && (
              <>
                {/* 透明遮罩：点菜单外任意处关闭 */}
                <div className="fixed inset-0 z-30" onClick={() => setShareMenuOpen(false)} />
                <div className="absolute left-0 top-full mt-1.5 z-40 w-60 rounded-xl border border-edge bg-white dark:bg-slate-800 shadow-xl py-1.5">
                  <button
                    onClick={() => { setShareMenuOpen(false); exportPng() }}
                    disabled={exporting}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-brand-soft/40 dark:hover:bg-slate-700/60 transition-colors text-left disabled:opacity-60"
                    title="把整份报告导出成一张 PNG 图片，适合直接发到聊天工具 / 存图留档"
                  >
                    <ImageDown className="h-4 w-4 shrink-0" /> 导出 PNG 图片
                  </button>
                  <button
                    onClick={() => { setShareMenuOpen(false); window.print() }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-brand-soft/40 dark:hover:bg-slate-700/60 transition-colors text-left"
                    title="调起浏览器打印对话框，可另存为 PDF（已隐藏页头页脚与按钮，只打印报告内容）"
                  >
                    <Printer className="h-4 w-4 shrink-0" /> 打印 / 存为 PDF
                  </button>
                  <button
                    onClick={() => { copySummary(); schedule(() => setShareMenuOpen(false), 1400) }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-left transition-colors"
                    title="复制纯文本决策摘要（推荐规格、排名、超预算排除说明、边际效益与避坑提示）到剪贴板"
                  >
                    {copied
                      ? <><Check className="h-4 w-4 shrink-0 text-emerald-500" /> <span className="text-emerald-500">已复制到剪贴板</span></>
                      : <><Copy className="h-4 w-4 shrink-0 text-slate-600 dark:text-slate-300" /> <span className="text-slate-600 dark:text-slate-300">复制文字摘要</span></>}
                  </button>
                  {getShareUrl && (
                    <button
                      onClick={() => { copyShareLink(); schedule(() => setShareMenuOpen(false), 1400) }}
                      disabled={sharing}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-left transition-colors disabled:opacity-60"
                      title="生成只读分享链接（清单与配置压缩进 URL，不含任何服务器）并复制到剪贴板"
                    >
                      {shareCopied
                        ? <><Check className="h-4 w-4 shrink-0 text-emerald-500" /> <span className="text-emerald-500">链接已复制</span></>
                        : <><Share2 className="h-4 w-4 shrink-0 text-slate-600 dark:text-slate-300" /> <span className="text-slate-600 dark:text-slate-300">{sharing ? '生成中…' : '复制分享链接'}</span></>}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* 决策偏好切换：提示紧贴按钮组正下方，明确它说的就是这组偏好 */}
        <div className="flex flex-col items-start sm:items-end gap-1.5">
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
                  title={PREFERENCE_HINT[opt.key]}
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
                <BudgetInput
                  value={config.budget}
                  onChange={onBudgetChange}
                  className="field py-1 text-xs w-20 tabular"
                />
              </div>
            )}
          </div>
          {preferenceHint && (
            <p className="text-xs text-slate-400">{preferenceHint}</p>
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

      {/* 空态只替换正文：工具条（含预算输入框）始终挂载，用户把预算调大即可自愈，
          不会出现"输到一半输入框被卸载、焦点丢失、后面按的键全丢"的问题 */}
      {items.length === 0 ? (
        emptyState
      ) : (
        <>
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
              warningPairs={warningPairs}
            />
          </div>

          {/* 图-caption：避坑注文已直接标在横条图编号旁；象限图放不下覆盖层，编号说明保留在这里，另附零散提示 / 图注 / 图例 */}
          <div className="mt-3 px-1">
            {((visual === 'quadrant' && warningPairs.length > 0) || warningNotes.length > 0) && (
              <div className="space-y-2.5">
                {visual === 'quadrant' && warningPairs.map((p, i) => {
                  const { lead, detail } = splitWarnText(p.text)
                  return (
                    <div key={`pair-${i}`} className="flex items-start gap-2">
                      <span
                        className="shrink-0 mt-[1px] inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white"
                        style={{ background: chartTheme.series.margin }}
                      >
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-[13px] font-bold leading-snug text-amber-600 dark:text-amber-400">{lead}</p>
                        {detail && <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{detail}</p>}
                      </div>
                    </div>
                  )
                })}
                {warningNotes.map((n, i) => (
                  <div key={`note-${i}`} className="flex items-start gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-[3px]" />
                    <p className="text-xs leading-relaxed text-slate-500">{n}</p>
                  </div>
                ))}
              </div>
            )}

            {(warningPairs.length > 0 || warningNotes.length > 0) && (
              <p className="mt-3 border-t border-edge pt-2.5 text-xs leading-relaxed text-slate-500">
                <span className="font-bold text-slate-600 dark:text-slate-300">图 1 ｜ </span>
                {figureNote}
              </p>
            )}

            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500">
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
              {visual !== 'quadrant' && warningPairs.length > 0 && (
                <span className="inline-flex items-center gap-1">
                  <WarnLegendMark color={chartTheme.series.margin} />
                  避坑对照（注文见图上编号旁）
                </span>
              )}
              <span className="text-slate-400 dark:text-slate-500">· 已合并同价同规格的口味变体 · 按总量升序 = 升档顺序</span>
            </div>
          </div>
        </motion.section>
      )}

      {/* ③ 升档值不值：一档一张卡，把「多花多少钱、多拿多少量、净省多少」说清 */}
      {margins.length > 0 && (
        <section className="glass rounded-2xl p-6">
          <h3 className="text-lg font-bold tracking-tight mb-1 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-brand" /> 升档值不值
          </h3>
          <p className="text-xs text-slate-500 mb-2">
            卡片「A → B」里的 <b className="text-slate-600">A 就是基准档</b>：默认按总量从小到大逐档对比，即每一档与紧挨着的更小一档比；
            <b className="text-slate-600">净省（白赚）</b> 是「这一档多拿的量，按基准档单价折算成钱，减去你多花的钱」——
            为正说明加量把多花的钱赚回来了，越大越值得升。
          </p>
          <p className="text-xs text-slate-500 mb-4">
            觉得默认基准不合心意？在下面选一个基准档，所有更大的档都会直接与它对比。
          </p>

          {/* 基准档选择：默认逐档相邻对比，也可固定某一档为基准 */}
          <div className="mb-4 flex items-center gap-2 flex-wrap text-xs no-print">
            <span className="text-slate-500">基准档：</span>
            <select
              value={marginBaseId ?? ''}
              onChange={(e) => setMarginBaseId(e.target.value || null)}
              className="rounded-lg border border-edge bg-brand-soft/30 px-2 py-1 text-xs text-slate-600 dark:text-slate-300 max-w-full"
              title="默认逐档对比（每档 vs 前一档）；选择某一档后，所有更大的档都与它直接对比"
            >
              <option value="">逐档对比（每档 vs 前一档，默认）</option>
              {marginTiers.map((t) => (
                <option key={t.id} value={t.id}>
                  {shortSpec(t.name)}（{fmt.priceUnit(displayUnitPrice(t.unitPrice, t.unit))}/{displayUnit(t.unit)}）
                </option>
              ))}
            </select>
          </div>

          {sectionMargins.length > 0 ? (
            /* 自适应网格：宽屏一行两张卡填满留白，窄屏退回单列；grid 默认拉伸，同行卡片等高 */
            <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
              {sectionMargins.map((m, i) => (
                <UpgradeCard key={`${m.fromId}-${m.toId}-${i}`} m={m} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500 rounded-xl border border-edge bg-brand-soft/20 px-3 py-2.5">
              选中的基准档已是总量最大的一档，没有可升的档位——换一个更小的基准试试。
            </p>
          )}

          {/* 逐档明细表：结论已在卡片里，明细默认收起 */}
          <button
            onClick={() => setShowMarginTable((v) => !v)}
            className="mt-4 text-xs text-slate-500 hover:text-brand transition-colors inline-flex items-center gap-1.5 no-print"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showMarginTable ? 'rotate-180' : ''}`} />
            {showMarginTable ? '收起逐档明细' : `展开逐档明细（${sectionMargins.length} 档）`}
          </button>

          {showMarginTable && sectionMargins.length > 0 && (
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
                  {sectionMargins.map((m, i) => {
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

      {/* ④ 因超预算被排除：把"消失的选项"显式交代，避免用户以为数据没识别到 */}
      {config.preference === 'budget' && typeof config.budget === 'number' && result.budgetExcludedItems.length > 0 && (
        <section className="rounded-2xl border border-edge/60 bg-slate-500/5 p-5">
          <h3 className="text-sm font-bold tracking-tight mb-3 flex items-center gap-2">
            <FilterX className="h-4 w-4 text-slate-400" /> 因超预算未纳入比较
            <span className="text-xs font-normal text-slate-500">共 {result.budgetExcludedItems.length} 项</span>
          </h3>
          <p className="text-xs text-slate-500 leading-relaxed mb-3">
            以下规格总价超过你设置的预算 {fmt.yuan(config.budget)}，已按「预算优先」规则排除在排名之外
            （按超出金额从少到多排列）。在上方把预算调大，即可让它们重新参与比较。
          </p>
          <BudgetExcludedList items={result.budgetExcludedItems} budget={config.budget} />
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
        </>
      )}
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