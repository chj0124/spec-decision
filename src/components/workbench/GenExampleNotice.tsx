import { AlertCircle, Package, Sparkles } from 'lucide-react'

/**
 * 生成来源 → 展示文案与配色。
 * source 必须显性化：用户要知道这份数据是"AI 刚生成的"还是"内置模板兜底的"，
 * 否则回退发生时用户无从判断自己看到的示例从哪来。
 */
const SOURCE_STYLE = {
  ai: {
    badge: 'AI 实时生成',
    icon: Sparkles,
    box: 'border-brand/60 bg-brand text-white shadow-glow',
    badgeCls: 'bg-white/20 text-white',
  },
  fallback: {
    badge: '内置示例',
    icon: Package,
    box: 'border-amber-400/40 bg-amber-400/10 text-amber-200',
    badgeCls: 'bg-amber-400/20 text-amber-200',
  },
} as const

/** AI 生成示例：状态提示（独立成行，避免大屏下挤进标题行） */
export function GenExampleNotice({ source, genSummary, genError }: {
  source: 'ai' | 'fallback' | null
  genSummary: string | null
  genError: string | null
}) {
  if (genSummary && source) {
    const { badge, icon: Icon, box, badgeCls } = SOURCE_STYLE[source]
    return (
      <div className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${box}`}>
        <Icon className="h-4 w-4 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <span className={`inline-block rounded-md px-1.5 py-0.5 mr-1.5 text-[11px] font-semibold align-middle ${badgeCls}`}>
            {badge}
          </span>
          <span className="font-medium">{genSummary}</span>
          {source === 'fallback' && genError && (
            <div className="mt-1 flex items-start gap-1.5 text-xs opacity-90">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-px" />
              <span>{genError}</span>
            </div>
          )}
        </div>
      </div>
    )
  }
  if (genError) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
        <span>{genError}（可在右上角「AI 设置」中配置后获得每次不同的真实生成结果。）</span>
      </div>
    )
  }
  return null
}
