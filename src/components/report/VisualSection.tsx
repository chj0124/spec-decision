import type { WarningPair } from '../../lib/types'
import type { SpecRow } from '../../lib/view-model'
import type { ChartTheme } from '../../lib/useChartTheme'
import { motion } from 'framer-motion'
import { Scale, AlertTriangle } from 'lucide-react'
import { splitWarnText } from '../../lib/view-model'
import { neutralBar, type VisualKind } from './constants'
import { MainVisual } from './MainVisual'
import { WarnLegendMark } from './WarnLegendMark'

/**
 * ② 主视觉：围绕「每单位单价」的四种看法，同一份数据同一把标尺。
 * 内含视图切换、图表、图注与图例。
 */
export function VisualSection({
  specRows,
  visual,
  onVisualChange,
  unitLabel,
  anchorId,
  theme,
  warningPairs,
  warningNotes,
}: {
  specRows: SpecRow[]
  visual: VisualKind
  onVisualChange: (k: VisualKind) => void
  unitLabel: string
  anchorId: string
  theme: ChartTheme
  warningPairs: WarningPair[]
  warningNotes: string[]
}) {
  // 主视觉候选（四种编码方式都做出来，后续按效果做减法）
  const VISUAL_OPTIONS: Array<{ k: VisualKind; label: string; hint: string }> = [
    { k: 'price', label: '每单位单价', hint: `横条越短越省：同一标尺下每${unitLabel}要花多少钱，虚线是全场平均价。` },
    { k: 'perYuan', label: '每元买到多少', hint: `横条越长越划算：同样 100 元，这一档能买到多少${unitLabel}。` },
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
            onClick={() => onVisualChange(opt.k)}
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
          unitLabel={unitLabel}
          anchorId={anchorId}
          theme={theme}
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
                    style={{ background: theme.series.margin }}
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
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: theme.series.unitPrice }} />
            推荐规格
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: neutralBar(theme.dark) }} />
            其余规格
          </span>
          {visual === 'quadrant' && (
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-full" style={{ background: theme.series.drop }} />
              最划算点
            </span>
          )}
          {visual !== 'quadrant' && warningPairs.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <WarnLegendMark color={theme.series.margin} />
              避坑对照（注文见图上编号旁）
            </span>
          )}
          <span className="text-slate-400 dark:text-slate-500">· 已合并同价同规格的口味变体 · 按总量升序 = 升档顺序</span>
        </div>
      </div>
    </motion.section>
  )
}
