import { motion } from 'framer-motion'
import { ClipboardList, ImagePlus, Loader2, Plus, Scale, Sparkles, UploadCloud } from 'lucide-react'

/** 三步说明：从「空表」到「能用报告做决定」的最短路径 */
const STEPS: Array<{ title: string; desc: string }> = [
  { title: '录入候选', desc: '粘贴规格表，或生成一份示例' },
  { title: '设定维度', desc: '给在意的参数配权重' },
  { title: '生成报告', desc: '直接看到买哪个、为什么' },
]

export function EmptyState({ genLoading, onGenExample, onPickImage, onQuickEntry, onAdd }: {
  genLoading: boolean
  onGenExample: () => void
  onPickImage: () => void
  onQuickEntry: () => void
  onAdd: () => void
}) {
  const pathCls =
    'group rounded-2xl border border-edge bg-panel/60 p-5 text-left hover:border-brand/50 hover:shadow-glow hover:-translate-y-0.5 transition-all disabled:opacity-60 disabled:cursor-wait disabled:hover:translate-y-0'
  const iconCls = 'mb-3 h-10 w-10 rounded-xl grid place-items-center'
  const subCls =
    'inline-flex items-center gap-1.5 rounded-xl border border-edge bg-panel/40 px-3 py-2 text-xs text-slate-500 hover:text-brand-deep hover:border-brand/40 transition-all'
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass rounded-2xl px-5 py-12 sm:py-14"
    >
      <div className="max-w-2xl mx-auto">
        <div className="text-center">
          <div className="mx-auto mb-5 h-14 w-14 rounded-2xl bg-brand-soft grid place-items-center shadow-soft">
            <Scale className="h-7 w-7 text-brand" />
          </div>
          <h3 className="text-lg sm:text-xl font-bold tracking-tight">先选一条路，把第一份清单填进来</h3>
          <p className="mt-1.5 text-xs sm:text-sm text-slate-500">
            粘贴你自己的规格表，或一键生成一份示例 —— 两条路都通向同一份决策报告
          </p>
        </div>

        {/* 两条主路径：自己的数据 vs 现成示例 */}
        <div className="mt-7 grid sm:grid-cols-2 gap-3 text-left">
          <button onClick={onQuickEntry} className={pathCls}>
            <div className={`${iconCls} bg-emerald-500/15`}>
              <ClipboardList className="h-5 w-5 text-emerald-500" />
            </div>
            <div className="text-sm font-semibold">粘贴你的规格表</div>
            <div className="text-xs text-slate-400 mt-1 leading-relaxed">
              一行一条「名称 + 价格」，整段商品标题或 Excel 表格直接粘进来，也能自动拆列
            </div>
          </button>
          <button onClick={onGenExample} disabled={genLoading} className={pathCls}>
            <div className={`${iconCls} bg-violet-500/15`}>
              {genLoading
                ? <Loader2 className="h-5 w-5 text-violet-500 animate-spin" />
                : <Sparkles className="h-5 w-5 text-violet-500" />}
            </div>
            <div className="text-sm font-semibold">{genLoading ? '生成中…' : '一键生成示例'}</div>
            <div className="text-xs text-slate-400 mt-1 leading-relaxed">
              {genLoading ? '正在准备一份逼真的比价数据…' : '还不想先找数据？载入一份真实商品示例，直接看完整效果'}
            </div>
          </button>
        </div>

        {/* 三步说明 */}
        <ol className="mt-5 grid sm:grid-cols-3 gap-2 text-left">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-xl border border-edge/60 bg-panel/40 px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                <span className="h-4 w-4 rounded-full bg-brand/15 text-brand text-[10px] font-bold grid place-items-center">
                  {i + 1}
                </span>
                <span className="text-xs font-semibold">{s.title}</span>
              </div>
              <div className="mt-1 text-xs text-slate-400 leading-relaxed">{s.desc}</div>
            </li>
          ))}
        </ol>

        {/* 备选入口：不如上面两条常用，但别让小众需求无处可去 */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <span className="text-xs text-slate-500">也可以：</span>
          <button onClick={onPickImage} className={subCls}>
            <ImagePlus className="h-3.5 w-3.5" /> 截图识别
          </button>
          <button onClick={onAdd} className={subCls}>
            <Plus className="h-3.5 w-3.5" /> 手动添加
          </button>
        </div>

        <p className="mt-4 text-xs text-slate-400 flex items-center justify-center gap-1.5 flex-wrap">
          <UploadCloud className="h-3.5 w-3.5 text-brand/70" />
          截图可直接拖到页面任意位置，或按
          <kbd className="px-1.5 py-0.5 rounded border border-edge bg-brand-soft/60 text-[11px] font-mono">Ctrl+V</kbd>
          粘贴截图 / Excel 表格
        </p>
      </div>
    </motion.div>
  )
}
