import { AlertCircle, Sparkles } from 'lucide-react'

/** AI 生成示例：状态提示（独立成行，避免大屏下挤进标题行） */
export function GenExampleNotice({ genSummary, genError }: { genSummary: string | null; genError: string | null }) {
  return (
    <>
      {genSummary && !genError && (
        <div className="flex items-start gap-2 rounded-xl border border-brand/60 bg-brand px-3 py-2.5 text-sm text-white shadow-glow">
          <Sparkles className="h-4 w-4 shrink-0 mt-0.5" />
          <span className="font-medium">{genSummary}</span>
        </div>
      )}
      {genError && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{genError}（可在右上角「AI 设置」中配置后获得每次不同的真实生成结果。）</span>
        </div>
      )}
    </>
  )
}
