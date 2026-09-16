import { AlertTriangle } from 'lucide-react'

/**
 * 报告顶部的一组提示条：分享链接过长、导出失败、单位混杂警告。
 * 三者条件互不依赖，顺序与原文一致。
 */
export function ReportAlerts({
  shareTooLong,
  onForceCopyShareLink,
  onDismissShareTooLong,
  exportError,
  onDismissExportError,
  unitWarning,
}: {
  shareTooLong: { url: string; len: number } | null
  onForceCopyShareLink: () => void
  onDismissShareTooLong: () => void
  exportError: string | null
  onDismissExportError: () => void
  unitWarning?: string | null
}) {
  return (
    <>
      {shareTooLong && (
        <div className="rounded-2xl border border-amber-400/40 bg-amber-500/5 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 text-xs text-amber-600 dark:text-amber-400 no-print">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1">
            清单较大，分享链接约 <strong className="tabular">{shareTooLong.len}</strong> 字符，微信 / 邮件等可能自动截断。
            建议回工作台用「<strong>导出备份</strong>」以文件方式分享，或仍复制该链接。
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onForceCopyShareLink}
              className="px-3 py-1.5 rounded-lg bg-amber-500 text-white hover:opacity-90 transition-opacity"
            >
              仍要复制链接
            </button>
            <button
              onClick={onDismissShareTooLong}
              className="px-3 py-1.5 rounded-lg border border-edge text-slate-500 hover:text-brand-deep hover:border-brand/50 transition-all"
            >
              关闭
            </button>
          </div>
        </div>
      )}

      {exportError && (
        <div className="rounded-2xl border border-amber-400/40 bg-amber-500/5 px-4 py-3 flex items-center gap-3 text-xs text-amber-600 dark:text-amber-400 no-print">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1">{exportError}</span>
          <button
            onClick={onDismissExportError}
            className="px-3 py-1.5 rounded-lg border border-edge text-slate-500 hover:text-brand-deep hover:border-brand/50 transition-all shrink-0"
          >
            知道了
          </button>
        </div>
      )}

      {/* 单位混杂警告 */}
      {unitWarning && (
        <div className="flex gap-3 rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4">
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-700">单位无法直接比价</p>
            <p className="text-xs text-amber-600 mt-0.5 leading-relaxed">{unitWarning}</p>
          </div>
        </div>
      )}
    </>
  )
}
