import { motion } from 'framer-motion'
import { Lightbulb } from 'lucide-react'
import { fmt } from '../../lib/engine'
import type { OneLiner } from '../../lib/view-model'

/** ① 一句话结论：不读表格就能拿到的性价比答案 */
export function ConclusionCard({ oneLiner, unitLabel }: { oneLiner: OneLiner; unitLabel: string }) {
  return (
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
        ，每{unitLabel}只要 <span className="font-bold text-brand tabular">{fmt.priceUnit(oneLiner.anchor.perUnit)}</span>
        ，比单价最高的「{oneLiner.worst.name}」每{unitLabel}省
        <span className="font-bold text-emerald-500 tabular"> {fmt.priceUnit(oneLiner.savePerUnit)}</span>
        （便宜 {oneLiner.pct.toFixed(0)}%）
        {oneLiner.vsWorst >= 1 && (
          <>，按同样一档的量买能省 <span className="font-bold text-emerald-500 tabular">≈{fmt.yuan(oneLiner.vsWorst)}</span></>
        )}
        。
      </p>
    </motion.div>
  )
}
