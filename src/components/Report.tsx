import { useEffect, useMemo, useRef, useState } from 'react'
import type { DecisionResult, DecisionConfig, Preference } from '../lib/types'
import { isStale, mergeVariantSkus, inferFlavorLabel, priceTrend, displayUnit, marginAnalysis } from '../lib/engine'
import {
  buildPreferenceHint, buildSummaryText,
  deriveFlavorColorMap, deriveGroupOptions,
  deriveSpecRows, deriveVisualAnchorId, deriveOneLiner,
} from '../lib/view-model'
import type { FullGroupBy, SpecRow } from '../lib/view-model'
import { palette } from '../lib/palette'
import { useChartTheme } from '../lib/useChartTheme'
import { exportNodeToPng, buildReportFileName, EXPORT_BG } from '../lib/exportImage'
import { writeClipboard } from './report/clipboard'
import { SHARE_URL_SOFT_LIMIT, type VisualKind } from './report/constants'
import { ReportToolbar } from './report/ReportToolbar'
import { ReportAlerts } from './report/ReportAlerts'
import { EmptyState } from './report/EmptyState'
import { ConclusionCard } from './report/ConclusionCard'
import { BestCard } from './report/BestCard'
import { VisualSection } from './report/VisualSection'
import { MarginSection } from './report/MarginSection'
import { BudgetExcludedSection } from './report/BudgetExcludedSection'
import { DetailSection } from './report/DetailSection'

interface Props {
  result: DecisionResult
  config: DecisionConfig
  unitWarning?: string | null
  onBack: () => void
  onPreferenceChange: (p: Preference) => void
  onBudgetChange: (budget: number | undefined) => void
  /** 生成可分享链接（只读视图下不传，则不显示分享按钮） */
  getShareUrl?: () => Promise<string>
}

export default function Report({ result, config, unitWarning, onBack, onPreferenceChange, onBudgetChange, getShareUrl }: Props) {
  const { items, best, margins, warningPairs, warningNotes, reasons, clusters, hasVariants } = result
  const chartTheme = useChartTheme()
  // 决策偏好动态提示：说清当前数据下各偏好的排名差异（为什么点了没变化 / 权重侧重在哪）
  const preferenceHint = buildPreferenceHint(items, config, config.preference)
  // 冠军规格的价格走势：跨天变过价（≥2 条记录）时才有，用于提示"现在买是不是比上次贵"
  const bestTrend = priceTrend(best?.priceHistory)
  // 冠军价格最近一次记录的时间：结论是基于"什么时候的价格"必须说清楚。
  // 注意走势横幅只在 ≥2 条记录时出现，而"过期"只要 1 条记录就能判断，所以这里单独算。
  const bestPriceAt = best?.priceHistory?.[best.priceHistory.length - 1]?.t
  const bestStale = isStale(bestPriceAt)

  // 导出整份报告为 PNG：依赖 html-to-image，按需动态加载（见 lib/exportImage）
  const reportRef = useRef<HTMLDivElement>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const exportPng = async () => {
    const node = reportRef.current
    if (!node || exporting) return
    setExporting(true)
    setExportError(null)
    try {
      const dark = document.documentElement.classList.contains('dark')
      await exportNodeToPng(node, {
        fileName: `${buildReportFileName(config.category)}.png`,
        background: dark ? EXPORT_BG.dark : EXPORT_BG.light,
      })
    } catch {
      setExportError('导出图片失败，可改用「打印 / PDF」另存为 PDF 或图片。')
    } finally {
      setExporting(false)
    }
  }

  // 组件内所有「延时恢复文案 / 延时关菜单」的定时器统一登记，卸载时一次性清理，
  // 避免卸载后回调触发 setState 造成 "setState on unmounted component" 告警与内存泄漏。
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  const schedule = (fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timersRef.current.delete(id)
      fn()
    }, ms)
    timersRef.current.add(id)
  }
  useEffect(() => () => {
    timersRef.current.forEach((id) => clearTimeout(id))
    timersRef.current.clear()
  }, [])

  // 复制决策摘要到剪贴板（2 秒后恢复按钮文案）
  const [copied, setCopied] = useState(false)
  // 导出 / 分享下拉菜单开关
  const [shareMenuOpen, setShareMenuOpen] = useState(false)
  const copySummary = async () => {
    const text = buildSummaryText(result, config)
    if (!text) return
    await writeClipboard(text)
    setCopied(true)
    schedule(() => setCopied(false), 2000)
  }

  // 生成只读分享链接并复制（数据压缩进 URL hash，无需后端）
  const [shareCopied, setShareCopied] = useState(false)
  const [sharing, setSharing] = useState(false)
  // 超长链接护栏：部分聊天工具/邮件会截断超长 URL，超过阈值先提示改用备份文件
  const [shareTooLong, setShareTooLong] = useState<{ url: string; len: number } | null>(null)
  const copyShareLink = async () => {
    if (!getShareUrl || sharing) return
    setSharing(true)
    try {
      const url = await getShareUrl()
      if (url.length > SHARE_URL_SOFT_LIMIT) {
        setShareCopied(false)
        setShareTooLong({ url, len: url.length })
        return
      }
      setShareTooLong(null)
      await writeClipboard(url)
      setShareCopied(true)
      schedule(() => setShareCopied(false), 2500)
    } finally {
      setSharing(false)
    }
  }

  const forceCopyShareLink = async () => {
    if (!shareTooLong) return
    await writeClipboard(shareTooLong.url)
    setShareTooLong(null)
    setShareCopied(true)
    schedule(() => setShareCopied(false), 2500)
  }

  // 有干扰维度（同定价多口味）时，默认用簇化简视图
  const [view, setView] = useState<'cluster' | 'full'>(hasVariants ? 'cluster' : 'full')
  // 用户手动切换过则尊重其选择；否则跟随数据（识别/导入后 hasVariants 可能变化）
  const userToggled = useRef(false)
  useEffect(() => {
    if (!userToggled.current) setView(hasVariants ? 'cluster' : 'full')
  }, [hasVariants])
  const switchView = (v: 'cluster' | 'full') => {
    userToggled.current = true
    setView(v)
  }

  // 主视觉类型：四种候选编码方式，默认「每单位单价」最直接
  const [visual, setVisual] = useState<VisualKind>('price')
  // 升档基准档：null = 默认逐档相邻对比；选中某个规格 id 后，所有更大档都直接与它比
  const [marginBaseId, setMarginBaseId] = useState<string | null>(null)
  // 逐档明细表默认收起：升档卡片已把结论说完，明细按需展开
  const [showMarginTable, setShowMarginTable] = useState(false)
  // 完整排名表默认收起：报告先给结论，明细按需展开
  const [showDetail, setShowDetail] = useState(false)

  // 升档基准档候选：与 marginAnalysis 同源（同价同规格已合并、按总量升序）
  const marginTiers = useMemo(
    () => mergeVariantSkus(items).sort((a, b) => a.totalQuantity - b.totalQuantity),
    [items],
  )
  // 当前基准下的升档结论：默认逐档相邻对比；选了基准档则所有更大档与它直接比
  const sectionMargins = useMemo(
    () => marginAnalysis(items, marginBaseId ?? undefined),
    [items, marginBaseId],
  )
  // 数据更新后选中的基准档可能已不存在（被删除 / 识别换了一批），自动退回默认逐档对比
  useEffect(() => {
    if (marginBaseId && !marginTiers.some((t) => t.id === marginBaseId)) setMarginBaseId(null)
  }, [marginTiers, marginBaseId])

  // 全量视图分组折叠：与工作台一致的工具栏 + 可点击分组标题行
  const [groupBy, setGroupBy] = useState<FullGroupBy | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggleGroup = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const selectGroup = (key: FullGroupBy | null) => {
    setCollapsed(new Set())
    setGroupBy(key)
  }
  const flavorLabel = config.flavorLabel || inferFlavorLabel(config.category)
  // 口味分组底色：按 flavor 值稳定映射到调色板
  const flavorColorMap = deriveFlavorColorMap(items, palette.flavor)
  // 分组维度候选：过滤掉无区分意义的（所有 SKU 值相同 / 每组仅1项）
  const groupOptions = deriveGroupOptions(items, flavorLabel)

  // 区分两种空态：真没数据 vs 预算偏好下全部规格超预算被过滤
  const budgetEmpty = items.length === 0 && config.preference === 'budget' && result.budgetExcludedItems.length > 0

  // 决策单元：簇视图按簇，全量视图按单个规格
  const decisionUnits = view === 'cluster' ? clusters : null

  // 主视觉数据：先合并「同价同规格」的口味变体，再统一换算到展示单位（ml→L），
  // 让「每单位单价」成为全场唯一标尺。省下金额 = 相比全场最贵单价、按本档总量折算。
  const specRows: SpecRow[] = deriveSpecRows(items)
  // 展示单位标签（L / kg / 件…）：取列表里实际出现的单位换算结果
  const visualUnit = displayUnit(items[0]?.unit ?? '')
  // 高亮锚点：优先冠军规格；万一它被合并进同价变体，就退而选单价最低的那条。
  // 预算偏好下可能一条都不剩（items 为空），此时给空串兜底——空态不渲染主视觉，
  // 但这里在 return 之前求值，不给兜底会直接抛错把整个报告页打崩。
  const visualAnchorId = deriveVisualAnchorId(specRows, best?.id)

  // 一句话结论：把"最划算"折算成「每单位省了多少钱 + 便宜百分之几 + 等量能省多少」，
  // 不读表格也能直接拿到性价比结论。
  const oneLiner = deriveOneLiner(specRows, visualAnchorId)

  return (
    <div ref={reportRef} className="space-y-8">
      {/* 返回 + 导出 + 决策偏好 */}
      <ReportToolbar
        onBack={onBack}
        onPreferenceChange={onPreferenceChange}
        onBudgetChange={onBudgetChange}
        getShareUrl={getShareUrl}
        preference={config.preference}
        budget={config.budget}
        preferenceHint={preferenceHint}
        shareMenuOpen={shareMenuOpen}
        setShareMenuOpen={setShareMenuOpen}
        exporting={exporting}
        sharing={sharing}
        exportPng={exportPng}
        copySummary={copySummary}
        copied={copied}
        copyShareLink={copyShareLink}
        shareCopied={shareCopied}
        schedule={schedule}
      />

      <ReportAlerts
        shareTooLong={shareTooLong}
        onForceCopyShareLink={forceCopyShareLink}
        onDismissShareTooLong={() => setShareTooLong(null)}
        exportError={exportError}
        onDismissExportError={() => setExportError(null)}
        unitWarning={unitWarning}
      />

      {/* 空态只替换正文：工具条（含预算输入框）始终挂载，用户把预算调大即可自愈，
          不会出现"输到一半输入框被卸载、焦点丢失、后面按的键全丢"的问题 */}
      {items.length === 0 ? (
        <EmptyState
          budgetEmpty={budgetEmpty}
          budget={config.budget}
          excludedItems={result.budgetExcludedItems}
          onBack={onBack}
        />
      ) : (
        <>
          {/* ① 一句话结论：不读表格就能拿到的性价比答案 */}
          {oneLiner && <ConclusionCard oneLiner={oneLiner} unitLabel={visualUnit} />}

          {/* 冠军推荐 */}
          {best && (
            <BestCard
              best={best}
              bestTrend={bestTrend}
              bestPriceAt={bestPriceAt}
              bestStale={bestStale}
              reasons={reasons}
            />
          )}

          {/* ② 主视觉：围绕「每单位单价」的四种看法，同一份数据同一把标尺 */}
          {specRows.length >= 2 && (
            <VisualSection
              specRows={specRows}
              visual={visual}
              onVisualChange={setVisual}
              unitLabel={visualUnit}
              anchorId={visualAnchorId}
              theme={chartTheme}
              warningPairs={warningPairs}
              warningNotes={warningNotes}
            />
          )}

          {/* ③ 升档值不值：一档一张卡，把「多花多少钱、多拿多少量、净省多少」说清 */}
          <MarginSection
            margins={margins}
            marginBaseId={marginBaseId}
            onMarginBaseChange={setMarginBaseId}
            marginTiers={marginTiers}
            sectionMargins={sectionMargins}
            showMarginTable={showMarginTable}
            onToggleMarginTable={() => setShowMarginTable((v) => !v)}
          />

          {/* ④ 因超预算被排除：把"消失的选项"显式交代，避免用户以为数据没识别到 */}
          <BudgetExcludedSection
            preference={config.preference}
            budget={config.budget}
            excludedItems={result.budgetExcludedItems}
          />

          {/* ⑤ 明细（默认收起）：完整排名表，支持簇化简 / 全量切换与分组折叠 */}
          <DetailSection
            items={items}
            hasVariants={hasVariants}
            decisionUnits={decisionUnits}
            view={view}
            onSwitchView={switchView}
            showDetail={showDetail}
            onToggleDetail={() => setShowDetail((v) => !v)}
            groupBy={groupBy}
            onSelectGroup={selectGroup}
            groupOptions={groupOptions}
            collapsed={collapsed}
            onToggleGroup={toggleGroup}
            flavorLabel={flavorLabel}
            flavorColorMap={flavorColorMap}
          />
        </>
      )}
    </div>
  )
}
