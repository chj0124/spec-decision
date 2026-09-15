import { useState } from 'react'

export interface WeightPieDatum {
  name: string
  value: number
  color: string
}

const SIZE = 176
const CENTER = SIZE / 2
const OUTER = 70
const INNER = 36
const RADIUS = (OUTER + INNER) / 2
const STROKE = OUTER - INNER
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
const PAD_LEN = (CIRCUMFERENCE * 2) / 360

/**
 * 权重分布环形图。
 * 用内联 SVG 手绘，不依赖 recharts —— recharts 整包约 372KB，而这张图在首屏
 * 「参数维度与权重」面板展开时就会渲染，一旦用 recharts 就等于首屏白白拖走 372KB。
 * 环形用 stroke-dasharray 描边实现：天然规避圆弧在 100% 单段、零值段下的退化问题。
 */
export default function WeightPie({ data }: { data: WeightPieDatum[] }) {
  const [active, setActive] = useState<number | null>(null)

  const total = data.reduce((sum, d) => sum + Math.max(0, d.value), 0)

  let acc = 0
  const arcs = data
    .map((d, i) => ({ ...d, i, frac: total > 0 ? Math.max(0, d.value) / total : 0 }))
    .filter((d) => d.frac > 0)
    .map((d) => {
      const start = acc
      acc += d.frac
      return { ...d, start, len: Math.max(0, d.frac * CIRCUMFERENCE - PAD_LEN) }
    })

  const current = arcs.find((a) => a.i === active)

  return (
    <div className="w-full h-44 grid place-items-center">
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label="权重分布环形图"
        onMouseLeave={() => setActive(null)}
      >
        <g transform={`rotate(-90 ${CENTER} ${CENTER})`}>
          {arcs.map((a) => (
            <circle
              key={a.i}
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              fill="none"
              stroke={a.color}
              strokeWidth={STROKE}
              strokeDasharray={`${a.len} ${CIRCUMFERENCE - a.len}`}
              strokeDashoffset={-a.start * CIRCUMFERENCE}
              className="cursor-pointer transition-opacity"
              opacity={active === null || active === a.i ? 1 : 0.35}
              onMouseEnter={() => setActive(a.i)}
            />
          ))}
        </g>
        <text
          x={CENTER}
          y={CENTER - 5}
          textAnchor="middle"
          fontSize={10}
          fill="currentColor"
          className="text-slate-500"
        >
          {current ? current.name : '权重'}
        </text>
        <text
          x={CENTER}
          y={CENTER + 13}
          textAnchor="middle"
          fontSize={15}
          fill="currentColor"
          className="font-semibold text-slate-600"
        >
          {current ? `${Math.round(current.frac * 100)}%` : '—'}
        </text>
      </svg>
    </div>
  )
}
