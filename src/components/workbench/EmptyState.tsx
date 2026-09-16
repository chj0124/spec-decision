import { motion } from 'framer-motion'
import { ClipboardList, ImagePlus, Loader2, Plus, Scale, Sparkles, UploadCloud } from 'lucide-react'

export function EmptyState({ genLoading, onGenExample, onPickImage, onQuickEntry, onAdd }: {
  genLoading: boolean
  onGenExample: () => void
  onPickImage: () => void
  onQuickEntry: () => void
  onAdd: () => void
}) {
  const cardCls =
    'group rounded-2xl border border-edge bg-panel/60 p-5 text-left hover:border-brand/50 hover:shadow-glow hover:-translate-y-0.5 transition-all disabled:opacity-60 disabled:cursor-wait disabled:hover:translate-y-0'
  const iconCls = 'mb-3 h-10 w-10 rounded-xl grid place-items-center'
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass rounded-2xl px-5 py-12 sm:py-16"
    >
      <div className="max-w-2xl mx-auto text-center">
        <div className="mx-auto mb-5 h-14 w-14 rounded-2xl bg-brand-soft grid place-items-center shadow-soft">
          <Scale className="h-7 w-7 text-brand" />
        </div>
        <h3 className="text-lg sm:text-xl font-bold tracking-tight">从任意一种方式开始</h3>
        <p className="mt-1.5 text-xs sm:text-sm text-slate-500">
          填写、截图或粘贴，30 秒搭好一个比价清单
        </p>
        <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-left">
          <button onClick={onQuickEntry} className={cardCls}>
            <div className={`${iconCls} bg-amber-500/15`}>
              <ClipboardList className="h-5 w-5 text-amber-500" />
            </div>
            <div className="text-sm font-semibold">极速录入</div>
            <div className="text-xs text-slate-400 mt-0.5">一行一条规格 + 价格</div>
          </button>
          <button onClick={onGenExample} disabled={genLoading} className={cardCls}>
            <div className={`${iconCls} bg-violet-500/15`}>
              {genLoading
                ? <Loader2 className="h-5 w-5 text-violet-500 animate-spin" />
                : <Sparkles className="h-5 w-5 text-violet-500" />}
            </div>
            <div className="text-sm font-semibold">{genLoading ? '生成中…' : 'AI 生成示例'}</div>
            <div className="text-xs text-slate-400 mt-0.5">先看看完整效果</div>
          </button>
          <button onClick={onPickImage} className={cardCls}>
            <div className={`${iconCls} bg-brand/10`}>
              <ImagePlus className="h-5 w-5 text-brand" />
            </div>
            <div className="text-sm font-semibold">AI 截图识别</div>
            <div className="text-xs text-slate-400 mt-0.5">商品页截图自动提取</div>
          </button>
          <button onClick={onAdd} className={cardCls}>
            <div className={`${iconCls} bg-emerald-500/15`}>
              <Plus className="h-5 w-5 text-emerald-500" />
            </div>
            <div className="text-sm font-semibold">手动添加</div>
            <div className="text-xs text-slate-400 mt-0.5">逐行填写规格价格</div>
          </button>
        </div>
        <p className="mt-5 text-xs text-slate-400 flex items-center justify-center gap-1.5 flex-wrap">
          <UploadCloud className="h-3.5 w-3.5 text-brand/70" />
          也可以把截图拖到页面任意位置，或按
          <kbd className="px-1.5 py-0.5 rounded border border-edge bg-brand-soft/60 text-[11px] font-mono">Ctrl+V</kbd>
          粘贴截图 / Excel 表格
        </p>
      </div>
    </motion.div>
  )
}
