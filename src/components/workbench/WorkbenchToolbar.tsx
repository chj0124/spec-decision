import type { RefObject } from 'react'
import { ImagePlus, Loader2, Sparkles, UploadCloud, Zap } from 'lucide-react'

interface WorkbenchToolbarProps {
  quickOpen: boolean
  onToggleQuick: () => void
  genLoading: boolean
  onGenExample: () => void
  fileRef: RefObject<HTMLInputElement>
  onPickImage: (files: FileList | null) => void
}

/** 顶部说明 + 快捷操作（极速录入 / AI 生成示例 / AI 截图识别） */
export function WorkbenchToolbar({
  quickOpen,
  onToggleQuick,
  genLoading,
  onGenExample,
  fileRef,
  onPickImage,
}: WorkbenchToolbarProps) {
  return (
    <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
      <div>
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
          录入规格，
          <span className="text-brand">揪出最划算的</span>
        </h2>
        <p className="mt-2 text-sm text-slate-400 max-w-xl leading-relaxed">
          把每个购买选项的名字、价格、单件含量与件数填进来，系统自动换算每单位价格，并结合附加参数给出推荐。
        </p>
        <p className="mt-1.5 text-xs text-slate-500 flex items-center gap-1.5 flex-wrap">
          <UploadCloud className="h-3.5 w-3.5 text-brand/70" />
          也可以直接把商品截图<b className="text-slate-600 font-medium">拖到页面任意位置</b>，或截图后按
          <kbd className="px-1.5 py-0.5 rounded border border-edge bg-brand-soft/60 text-sm font-mono">Ctrl+V</kbd>
          粘贴识别。
          <span className="text-brand/80">支持一次拖入多张截图（如不同规格页面），自动合并去重。</span>
          <span className="text-emerald-400/80">也支持直接粘贴 Excel/电商页面表格（Ctrl+V），自动识别列。</span>
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={onToggleQuick}
          className={`px-3 py-2 rounded-lg border text-xs font-semibold transition-all flex items-center gap-1.5 ${
            quickOpen
              ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-600 dark:text-emerald-300'
              : 'bg-emerald-500/10 border-emerald-400/30 text-emerald-600 dark:text-emerald-300 hover:shadow-glow'
          }`}
          title="一行一条：规格 + 价格，整段商品标题直接粘贴也行"
        >
          <Zap className="h-3.5 w-3.5" /> 极速录入
        </button>
        <button
          onClick={onGenExample}
          disabled={genLoading}
          className="px-3 py-2 rounded-lg bg-gradient-to-r from-violet-500/20 to-fuchsia-500/20 border border-violet-400/40 text-xs font-semibold text-violet-300 hover:shadow-glow transition-all flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-wait"
          title="用 AI 自动生成一份逼真的多 SKU 比价示例（每次品类不同；未配置 AI 时回退内置真实商品模板）"
        >
          {genLoading
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <Sparkles className="h-3.5 w-3.5" />}
          {genLoading ? '生成中…' : 'AI 生成示例'}
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="px-3 py-2 rounded-lg bg-gradient-to-r from-brand/15 to-violet-500/15 border border-brand/40 text-xs font-semibold text-brand hover:shadow-glow transition-all flex items-center gap-1.5"
          title="支持一次选择多张截图（如不同 SKU 选择器页面），自动合并去重"
        >
          <ImagePlus className="h-3.5 w-3.5" /> AI 截图识别
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && onPickImage(e.target.files)}
        />
      </div>
    </div>
  )
}
