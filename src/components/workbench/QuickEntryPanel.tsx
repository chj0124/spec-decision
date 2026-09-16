import { useEffect, useMemo, useRef, useState } from 'react'
import type { Sku } from '../../lib/types'
import { fmt } from '../../lib/engine'
import { parseQuickEntry, quickEntryToSku, quickEntryUnitPrice } from '../../lib/quickEntry'
import { AlertCircle, Check, X, Zap } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface QuickEntryPanelProps {
  open: boolean
  onClose: () => void
  skus: Sku[]
  onChange: (s: Sku[]) => void
  flavorLabel: string
}

/**
 * 极速录入面板：一行一条「规格 价格」，粘贴即解析，入表前先看清谁划算。
 * 面板常驻挂载（AnimatePresence 内部按 open 切换），保证关闭时的收起动画仍然生效。
 */
export function QuickEntryPanel({ open, onClose, skus, onChange, flavorLabel }: QuickEntryPanelProps) {
  const [quickText, setQuickText] = useState('')
  const [quickFlavor, setQuickFlavor] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)

  const quickItems = useMemo(
    () => (open ? parseQuickEntry(quickText, quickFlavor) : []),
    [open, quickText, quickFlavor],
  )
  const quickOk = quickItems.filter((i) => i.ok)

  // 预览里就把「谁最划算」算出来，省得导入后还要翻到报告里回看。
  // 只有 2 条以上有效单价才标注，否则"最划算"只是个自封的头衔。
  const quickBest = useMemo(() => {
    const cands = quickItems
      .map((it, i) => ({ i, v: quickEntryUnitPrice(it) }))
      .filter((x) => x.v > 0)
    if (cands.length < 2) return -1
    return cands.reduce((a, b) => (b.v < a.v ? b : a)).i
  }, [quickItems])

  const confirmQuickImport = (mode: 'append' | 'replace') => {
    if (quickOk.length === 0) return
    const rows = quickOk.map(quickEntryToSku)
    onChange(mode === 'replace' ? rows : [...skus, ...rows])
    setQuickText('')
    setQuickFlavor('')
    onClose()
  }

  // 空状态里的入口离面板很远，打开时滚过去，避免用户以为没反应
  useEffect(() => {
    if (open) panelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [open])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          key="quick"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden"
        >
          <div className="glass rounded-2xl p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="text-sm font-semibold flex items-center gap-1.5">
                <Zap className="h-4 w-4 text-emerald-500" /> 文本极速录入
              </span>
              <span className="text-xs text-slate-400">一行一条，规格 + 价格，顺序不限</span>
              <label className="flex items-center gap-1.5 ml-auto">
                <span className="text-[10px] text-slate-400 whitespace-nowrap">统一口味</span>
                <input
                  value={quickFlavor}
                  onChange={(e) => setQuickFlavor(e.target.value)}
                  placeholder={flavorLabel}
                  className="field py-1 text-xs w-28"
                />
              </label>
              <button
                onClick={onClose}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                aria-label="关闭极速录入"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <textarea
              value={quickText}
              onChange={(e) => setQuickText(e.target.value)}
              rows={4}
              spellCheck={false}
              placeholder={'每行一条，例如：\n300ml*12瓶*2箱 27.91\n券后¥49.7 无糖芬达 500ml*24瓶\n888ml*12 34.4'}
              className="field py-2 text-xs font-mono resize-y min-h-[88px]"
            />

            {quickItems.length > 0 && (
              <div className="rounded-xl border border-edge divide-y divide-edge/60 overflow-hidden">
                {quickItems.map((it, i) => (
                  <div key={i} className={`px-3 py-2 ${it.ok ? '' : 'bg-amber-400/[0.06]'}`}>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono text-slate-400 shrink-0">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      {it.ok ? (
                        <>
                          <span className="font-medium truncate">{it.name}</span>
                          <span className="ml-auto shrink-0 tabular text-slate-500">
                            {it.price > 0 ? fmt.yuan(it.price) : '待补价'}
                          </span>
                        </>
                      ) : (
                        <span className="text-slate-400 truncate">{it.raw}</span>
                      )}
                    </div>
                    {it.ok && (
                      <div className="mt-1 pl-7 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                        <span className="tabular">
                          总量 {fmt.num(it.quantity * Math.max(1, it.packs))}{it.unit}
                        </span>
                        <span className="text-slate-400">·</span>
                        <span className="tabular">
                          {it.price > 0
                            ? `${fmt.priceUnit(quickEntryUnitPrice(it))}/${it.unit}`
                            : '单价待补'}
                        </span>
                        {i === quickBest && (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 font-semibold">
                            最划算
                          </span>
                        )}
                      </div>
                    )}
                    {it.note && (
                      <div className="mt-1 pl-7 flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-300">
                        <AlertCircle className="h-3 w-3 shrink-0" />{it.note}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">
                识别出{' '}
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold tabular">
                  {quickOk.length}
                </span>{' '}
                条可用
                {quickItems.length > quickOk.length &&
                  `，另有 ${quickItems.length - quickOk.length} 条需要补一下规格`}
              </span>
              <div className="ml-auto flex flex-wrap gap-2">
                {skus.length > 0 && (
                  <button
                    onClick={() => confirmQuickImport('replace')}
                    disabled={quickOk.length === 0}
                    className="px-3 py-1.5 rounded-lg text-xs text-slate-500 border border-edge hover:text-brand-deep hover:border-brand/40 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    title="丢弃表格里现有的行，只保留上面解析出的结果"
                  >
                    清空并导入
                  </button>
                )}
                <button
                  onClick={() => confirmQuickImport('append')}
                  disabled={quickOk.length === 0}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/15 border border-emerald-400/40 text-emerald-600 dark:text-emerald-300 hover:shadow-glow transition-all flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Check className="h-3.5 w-3.5" />
                  {quickOk.length > 0 ? `导入 ${quickOk.length} 条` : '导入'}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
