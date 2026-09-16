import { motion, AnimatePresence } from 'framer-motion'
import { UploadCloud } from 'lucide-react'

/** 拖入全屏高亮遮罩 */
export function DropOverlay({ dragging }: { dragging: boolean }) {
  return (
    <AnimatePresence>
      {dragging && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 grid place-items-center bg-ink/70 light:bg-slate-900/40 backdrop-blur-sm pointer-events-none"
        >
          <div className="rounded-3xl border-2 border-dashed border-brand/70 bg-panel/80 px-12 py-10 text-center shadow-glow">
            <UploadCloud className="h-12 w-12 mx-auto text-brand mb-3 animate-bounce" />
            <p className="text-lg font-bold text-brand">松开鼠标，AI 识别截图</p>
            <p className="text-xs text-slate-400 mt-1">自动提取规格与价格</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
