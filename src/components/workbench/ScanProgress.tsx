import { loadAiConfig, getVisionModel } from '../../lib/ai'
import { Loader2, X } from 'lucide-react'
import { motion } from 'framer-motion'

export interface ScanProgressProps {
  scanPreviews: string[]
  scanElapsed: number
  onCancel: () => void
}

/** AI 识别：扫描进度（缩略图 + 已等待时长 + 取消） */
export function ScanProgress({ scanPreviews, scanElapsed, onCancel }: ScanProgressProps) {
  return (
    <motion.div
      key="scanning"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="glass rounded-2xl p-4 flex items-center gap-4 overflow-hidden"
    >
      {scanPreviews.length > 0 && (
        <div className="flex gap-1.5 shrink-0">
          {scanPreviews.map((url, i) => (
            <div key={i} className="relative h-16 w-16 rounded-lg overflow-hidden border border-edge shrink-0">
              <img src={url} alt={`扫描 ${i + 1}`} className="h-full w-full object-cover" />
              <div className="absolute inset-0 bg-brand/10">
                <div className="absolute inset-x-0 h-0.5 bg-brand shadow-glow animate-[scan_1.2s_ease-in-out_infinite]" />
              </div>
              {scanPreviews.length > 1 && (
                <span className="absolute top-0.5 left-0.5 text-[9px] px-1 rounded bg-ink/70 text-brand font-mono font-bold">
                  {i + 1}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm text-brand">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          <span>
            {scanPreviews.length > 1
              ? `AI 正在并发识别 ${scanPreviews.length} 张截图…`
              : 'AI 正在识别图片中的所有规格与价格…'}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-3 text-sm text-slate-500">
          <span className="tabular">已等待 <span className={scanElapsed > 30 ? 'text-amber-400 font-semibold' : 'text-brand'}>{scanElapsed}</span> 秒</span>
          {(() => {
            const ai = loadAiConfig()
            const vm = getVisionModel(ai)
            return ai.enabled && vm
              ? <span className="truncate">模型：<code className="font-mono text-slate-400">{vm}</code></span>
              : <span>演示模式（未配置视觉模型）</span>
          })()}
          {scanElapsed > 30 && (
            <span className="text-amber-400">· 视觉模型处理图片较慢，请耐心等待（90秒超时）</span>
          )}
        </div>
      </div>
      <button
        onClick={onCancel}
        className="px-3 py-1.5 rounded-lg border border-edge text-xs text-slate-500 hover:text-red-400 hover:border-red-400/50 transition-all inline-flex items-center gap-1.5 shrink-0"
        title="取消识别"
      >
        <X className="h-3.5 w-3.5" /> 取消
      </button>
      <style>{`@keyframes scan{0%,100%{top:0}50%{top:calc(100% - 2px)}}`}</style>
    </motion.div>
  )
}
