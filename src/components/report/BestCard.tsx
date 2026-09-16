import type { ComputedSku } from '../../lib/types'
import { motion } from 'framer-motion'
import {
  Trophy, Lightbulb, CheckCircle2, AlertTriangle, RefreshCw, TrendingDown, TrendingUp, Minus,
} from 'lucide-react'
import { fmt, displayUnit, displayUnitPrice, displayQuantity, fmtPointDay, STALE_DAYS } from '../../lib/engine'
import type { PriceTrend } from '../../lib/engine'
import { packWord } from '../../lib/view-model'
import { CountUp } from './CountUp'

/** 冠军推荐卡片：核心指标 + 价格走势 + 数据新鲜度 + 推荐理由 */
export function BestCard({
  best,
  bestTrend,
  bestPriceAt,
  bestStale,
  reasons,
}: {
  best: ComputedSku
  bestTrend: PriceTrend | null
  bestPriceAt?: number
  bestStale: boolean
  reasons: string[]
}) {
  const TrendIcon = bestTrend?.direction === 'up' ? TrendingUp : bestTrend?.direction === 'down' ? TrendingDown : Minus
  return (
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
  )
}
