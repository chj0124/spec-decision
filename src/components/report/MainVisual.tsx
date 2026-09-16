import { useEffect, useRef, useState } from 'react'
import type { WarningPair } from '../../lib/types'
import type { SpecRow } from '../../lib/view-model'
import { fmt } from '../../lib/engine'
import type { ChartTheme } from '../../lib/useChartTheme'
import { neutralBar, type VisualKind } from './constants'
import { WarnOverlay } from './WarnOverlay'
import {
  Bar, BarChart, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ComposedChart, Line, Cell, ReferenceLine, ReferenceDot, Customized,
} from 'recharts'

/**
 * 性价比主视觉：同一份数据四种编码方式，都只围绕「每单位单价」。
 * - price    每单位单价横条（越短越省 + 平均线）
 * - perYuan  每 100 元买到多少（越长越划算）
 * - quadrant 性价比象限（总量 × 单价，连线即升档路径）
 * - savings  相对最贵档省下多少钱（绝对金额）
 * 冠军条统一高亮，其余中性色。
 */
export function MainVisual({
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
