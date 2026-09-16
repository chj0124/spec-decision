import type { Dispatch, SetStateAction } from 'react'
import type { Preference } from '../../lib/types'
import {
  ArrowLeft, Loader2, Share2, ChevronDown, ImageDown, Printer, Check, Copy,
} from 'lucide-react'
import { PREFERENCE_HINT } from './constants'
import { BudgetInput } from './BudgetInput'

/**
 * 顶部工具条：返回 + 导出/分享下拉菜单 + 决策偏好切换（含预算输入框）。
 * 工具条始终挂载（空态也不卸载），这样用户输到一半的预算不会丢焦点。
 */
export function ReportToolbar({
  onBack,
  onPreferenceChange,
  onBudgetChange,
  getShareUrl,
  preference,
  budget,
  preferenceHint,
  shareMenuOpen,
  setShareMenuOpen,
  exporting,
  sharing,
  exportPng,
  copySummary,
  copied,
  copyShareLink,
  shareCopied,
  schedule,
}: {
  onBack: () => void
  onPreferenceChange: (p: Preference) => void
  onBudgetChange: (budget: number | undefined) => void
  getShareUrl?: () => Promise<string>
  preference: Preference
  budget?: number
  preferenceHint: string | null
  shareMenuOpen: boolean
  setShareMenuOpen: Dispatch<SetStateAction<boolean>>
  exporting: boolean
  sharing: boolean
  exportPng: () => void
  copySummary: () => void
  copied: boolean
  copyShareLink: () => void
  shareCopied: boolean
  schedule: (fn: () => void, ms: number) => void
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={onBack}
          className="text-sm text-slate-400 hover:text-brand transition-colors inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="h-4 w-4" /> 返回编辑
        </button>
        <span className="text-edge">|</span>
        {/* 导出 / 分享：四个动作收进一个下拉菜单，工具栏只留一个入口 */}
        <div className="relative no-print">
          <button
            onClick={() => setShareMenuOpen((v) => !v)}
            className="text-sm text-slate-400 hover:text-brand transition-colors inline-flex items-center gap-1.5"
            title="导出图片 / 打印 PDF / 复制文字摘要 / 生成分享链接"
          >
            {exporting || sharing
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Share2 className="h-4 w-4" />}
            {exporting ? '生成中…' : sharing ? '生成中…' : '导出 / 分享'}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${shareMenuOpen ? 'rotate-180' : ''}`} />
          </button>
          {shareMenuOpen && (
            <>
              {/* 透明遮罩：点菜单外任意处关闭 */}
              <div className="fixed inset-0 z-30" onClick={() => setShareMenuOpen(false)} />
              <div className="absolute left-0 top-full mt-1.5 z-40 w-60 rounded-xl border border-edge bg-white dark:bg-slate-800 shadow-xl py-1.5">
                <button
                  onClick={() => { setShareMenuOpen(false); exportPng() }}
                  disabled={exporting}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-brand-soft/40 dark:hover:bg-slate-700/60 transition-colors text-left disabled:opacity-60"
                  title="把整份报告导出成一张 PNG 图片，适合直接发到聊天工具 / 存图留档"
                >
                  <ImageDown className="h-4 w-4 shrink-0" /> 导出 PNG 图片
                </button>
                <button
                  onClick={() => { setShareMenuOpen(false); window.print() }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-brand-soft/40 dark:hover:bg-slate-700/60 transition-colors text-left"
                  title="调起浏览器打印对话框，可另存为 PDF（已隐藏页头页脚与按钮，只打印报告内容）"
                >
                  <Printer className="h-4 w-4 shrink-0" /> 打印 / 存为 PDF
                </button>
                <button
                  onClick={() => { copySummary(); schedule(() => setShareMenuOpen(false), 1400) }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-left transition-colors"
                  title="复制纯文本决策摘要（推荐规格、排名、超预算排除说明、边际效益与避坑提示）到剪贴板"
                >
                  {copied
                    ? <><Check className="h-4 w-4 shrink-0 text-emerald-500" /> <span className="text-emerald-500">已复制到剪贴板</span></>
                    : <><Copy className="h-4 w-4 shrink-0 text-slate-600 dark:text-slate-300" /> <span className="text-slate-600 dark:text-slate-300">复制文字摘要</span></>}
                </button>
                {getShareUrl && (
                  <button
                    onClick={() => { copyShareLink(); schedule(() => setShareMenuOpen(false), 1400) }}
                    disabled={sharing}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-left transition-colors disabled:opacity-60"
                    title="生成只读分享链接（清单与配置压缩进 URL，不含任何服务器）并复制到剪贴板"
                  >
                    {shareCopied
                      ? <><Check className="h-4 w-4 shrink-0 text-emerald-500" /> <span className="text-emerald-500">链接已复制</span></>
                      : <><Share2 className="h-4 w-4 shrink-0 text-slate-600 dark:text-slate-300" /> <span className="text-slate-600 dark:text-slate-300">{sharing ? '生成中…' : '复制分享链接'}</span></>}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 决策偏好切换：提示紧贴按钮组正下方，明确它说的就是这组偏好 */}
      <div className="flex flex-col items-start sm:items-end gap-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500">决策偏好：</span>
          <div className="flex rounded-lg border border-edge overflow-hidden">
            {([
              { key: 'value', label: '性价比优先' },
              { key: 'score', label: '综合得分优先' },
              { key: 'budget', label: '预算优先' },
            ] as { key: Preference; label: string }[]).map((opt) => (
              <button
                key={opt.key}
                onClick={() => onPreferenceChange(opt.key)}
                title={PREFERENCE_HINT[opt.key]}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  preference === opt.key
                    ? 'bg-brand/15 text-brand'
                    : 'text-slate-400 hover:text-brand-deep'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {preference === 'budget' && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500">预算</span>
              <BudgetInput
                value={budget}
                onChange={onBudgetChange}
                className="field py-1 text-xs w-20 tabular"
              />
            </div>
          )}
        </div>
        {preferenceHint && (
          <p className="text-xs text-slate-400">{preferenceHint}</p>
        )}
      </div>
    </div>
  )
}
