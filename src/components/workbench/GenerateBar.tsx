import { ArrowRight } from 'lucide-react'

/** 底部生成：有效规格计数 + 生成决策报告入口 */
export function GenerateBar({ validCount, onGenerate }: { validCount: number; onGenerate: () => void }) {
  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 glass rounded-2xl p-5">
      <p className="text-sm text-slate-400">
        已填写 <span className="text-brand font-semibold tabular">{validCount}</span> 个有效规格
        {validCount < 2 && '（至少 2 个才能对比）'}
      </p>
      <button
        onClick={onGenerate}
        disabled={validCount < 2}
        className="w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-brand to-violet-500 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-glow active:scale-[0.98] transition-all"
      >
        生成决策报告 <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  )
}
