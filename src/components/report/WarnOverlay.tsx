import type { WarningPair } from '../../lib/types'
import type { SpecRow } from '../../lib/view-model'
import type { ChartTheme } from '../../lib/useChartTheme'
import { splitWarnText, wrapCjk } from '../../lib/view-model'

/** Customized 覆盖层能拿到的 recharts 图表内部状态（只声明用得到的字段） */
export interface WarnOverlayProps {
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
export function WarnOverlay({
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
