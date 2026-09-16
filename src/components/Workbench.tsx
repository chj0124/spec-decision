import { useEffect, useRef, useState } from 'react'
import type { Sku, DecisionConfig, ParamDim, ParamValue } from '../lib/types'
import { uid, recordPrice, inferFlavorLabel } from '../lib/engine'
import type { GroupBy } from '../lib/engine'
import { recognizeImages, toSku } from '../lib/recognize'
import { generateExample } from '../lib/aiSample'
import { deriveFlavorColorMap, deriveDimColorMaps, deriveDimHasGroup, skusHaveFlavor } from '../lib/view-model'
import { palette } from '../lib/palette'
import RecognizeReview from './RecognizeReview'
import { AnimatePresence } from 'framer-motion'
import { emptySku } from './workbench/emptySku'
import { UnitDatalist } from './workbench/UnitDatalist'
import { DropOverlay } from './workbench/DropOverlay'
import { WorkbenchToolbar } from './workbench/WorkbenchToolbar'
import { QuickEntryPanel } from './workbench/QuickEntryPanel'
import { GenExampleNotice } from './workbench/GenExampleNotice'
import { ScanProgress } from './workbench/ScanProgress'
import { DimPanel } from './workbench/DimPanel'
import { SkusSection } from './workbench/SkusSection'
import { GenerateBar } from './workbench/GenerateBar'
import { useGlobalDropPaste } from './workbench/useGlobalDropPaste'
import type { ReviewWithImages } from './workbench/useGlobalDropPaste'

interface Props {
  skus: Sku[]
  onChange: (s: Sku[]) => void
  onGenerate: () => void
  config: DecisionConfig
  onConfigChange: (c: DecisionConfig) => void
}

export default function Workbench({ skus, onChange, onGenerate, config, onConfigChange }: Props) {
  const [scanning, setScanning] = useState(false)
  const [scanPreviews, setScanPreviews] = useState<string[]>([])
  const [review, setReview] = useState<ReviewWithImages | null>(null)
  const [groupBy, setGroupBy] = useState<GroupBy | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [dimPanelOpen, setDimPanelOpen] = useState(true)
  const [scanElapsed, setScanElapsed] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const scanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const toggleGroup = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const update = (id: string, patch: Partial<Sku>) =>
    onChange(skus.map((s) => {
      if (s.id !== id) return s
      const next = { ...s, ...patch }
      // 改总价时顺带记一条价格历史（同日覆盖、条数上限，见 recordPrice）。
      // 放在这里而不是各个 onChange 里，是为了让桌面表格行 / 移动卡片 / 未来任何入口都自动记账。
      if (patch.price !== undefined) next.priceHistory = recordPrice(s.priceHistory, patch.price)
      return next
    }))

  /** 更新某个 SKU 的某个 param 维度值 */
  const updateParam = (id: string, dimId: string, value: ParamValue) =>
    onChange(skus.map((s) =>
      s.id === id ? { ...s, params: { ...(s.params ?? {}), [dimId]: value } } : s,
    ))

  const remove = (id: string) => onChange(skus.filter((s) => s.id !== id))
  const add = () => onChange([...skus, emptySku()])

  /**
   * 同款复制：比价里绝大多数场景是「同一个商品的不同规格」（三种芬达、两档咖啡），
   * 复制一份只改规格与价格，省掉重填口味/单位/维度。
   * 价格历史不跟着复制 —— 它记录的是原行自己的价格变动，跟过去会让涨跌徽标说谎。
   */
  const duplicate = (id: string) => {
    const i = skus.findIndex((s) => s.id === id)
    if (i < 0) return
    const copy: Sku = { ...skus[i], id: uid(), priceHistory: undefined }
    onChange([...skus.slice(0, i + 1), copy, ...skus.slice(i + 1)])
  }

  // 表格键盘导航：Enter 跳下一格，Ctrl/Cmd+Enter 快速加行并聚焦新行首格
  const tableRef = useRef<HTMLTableElement>(null)
  const focusNewRow = useRef(false)

  useEffect(() => {
    if (!focusNewRow.current) return
    focusNewRow.current = false
    const rows = tableRef.current?.querySelectorAll('tbody tr')
    const last = rows?.[rows.length - 1]
    ;(last?.querySelector('input') as HTMLElement | null)?.focus()
  }, [skus])

  const handleTableKey = (e: React.KeyboardEvent<HTMLTableElement>) => {
    if (e.key !== 'Enter') return
    const t = e.target as HTMLElement
    if (!(t instanceof HTMLInputElement || t instanceof HTMLSelectElement)) return
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) {
      focusNewRow.current = true
      add()
      return
    }
    const fields = Array.from(
      tableRef.current?.querySelectorAll('tbody input, tbody select') ?? [],
    )
    const next = fields[fields.indexOf(t) + 1] as HTMLElement | undefined
    next?.focus()
  }

  // AI 生成示例：调用 generator（已配置 AI 则实时生成，否则回退内置真实模板）
  const [genLoading, setGenLoading] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [genSummary, setGenSummary] = useState<string | null>(null)
  const handleGenExample = async () => {
    setGenLoading(true)
    setGenError(null)
    setGenSummary(null)
    try {
      const { skus: g, config: c, source, note, summary } = await generateExample()
      onChange(g)
      onConfigChange(c)
      setGenSummary(summary)
      if (source === 'fallback' && note) {
        setGenError(note)
      }
    } catch (e: any) {
      setGenError('生成示例失败：' + (e?.message ?? e))
    } finally {
      setGenLoading(false)
    }
  }

  // 极速录入面板的开关由工具条与空状态共同驱动，面板内部自管文本状态。
  const [quickOpen, setQuickOpen] = useState(false)

  // ============ 维度管理 ============
  const addDim = () => {
    const newDim: ParamDim = {
      id: uid(),
      label: '新维度',
      type: 'higher-better',
      weight: 20,
    }
    onConfigChange({ ...config, dims: [...config.dims, newDim] })
  }
  const updateDim = (id: string, patch: Partial<ParamDim>) =>
    onConfigChange({
      ...config,
      dims: config.dims.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    })
  const removeDim = (id: string) =>
    onConfigChange({
      ...config,
      dims: config.dims.filter((d) => d.id !== id),
    })

  // 语音播报（Web Speech API）：识别完成/失败时提示用户
  const speak = (text: string) => {
    try {
      const synth = window.speechSynthesis
      if (!synth) return
      synth.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'zh-CN'
      u.rate = 1.15
      synth.speak(u)
    } catch { /* 静默失败 */ }
  }

  // AI 截图识别：支持单张或多张批量识别。
  // 多张时并发识别后按规格名合并去重，解决「价格藏在 SKU 选择器里」需逐页截图的痛点。
  const handleImages = async (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith('image/'))
    if (imgs.length === 0) return
    const urls = imgs.map((f) => URL.createObjectURL(f))
    setScanPreviews(urls)
    setScanning(true)
    setReview(null)
    setScanElapsed(0)
    // 启动计时器，每秒更新等待时长
    scanTimerRef.current = setInterval(() => setScanElapsed((s) => s + 1), 1000)
    try {
      const result = await recognizeImages(imgs)
      setReview({ ...result, images: urls })
      // 语音提示识别结果
      if (result.source === 'error') {
        speak('识别失败，请检查截图或重试')
      } else if (result.items.length > 0) {
        speak(`识别完成，识别到${result.items.length}个规格`)
      } else {
        speak('识别完成，但未识别到规格')
      }
    } finally {
      if (scanTimerRef.current) {
        clearInterval(scanTimerRef.current)
        scanTimerRef.current = null
      }
      setScanning(false)
    }
  }

  // 取消扫描（关闭扫描面板，释放预览 URL）
  const cancelScan = () => {
    if (scanTimerRef.current) {
      clearInterval(scanTimerRef.current)
      scanTimerRef.current = null
    }
    setScanning(false)
    setScanPreviews([])
    setScanElapsed(0)
  }

  // 确认导入：把修正后的识别结果写入工作台。
  // mode='replace'：清空现有规格与未用到的旧维度（适合换商品重新识别）；
  // mode='append'：保留现有规格，识别结果追加到后面，维度合并去重。
  const confirmImport = (
    items: import('../lib/recognize').RecognizedSku[],
    dims: import('../lib/recognize').RecognizedDim[] | undefined,
    mode: 'replace' | 'append',
  ) => {
    const labelToId: Record<string, string> = {}
    const existingByLabel = new Map(config.dims.map((d) => [d.label, d]))
    // 替换模式只保留本次识别到的维度（同 label 复用旧 id/weight，保留用户调过的权重）；
    // 追加模式在现有维度基础上合并新维度。
    const mergedDims: ParamDim[] = mode === 'append' ? [...config.dims] : []
    for (const d of dims ?? []) {
      const existing = existingByLabel.get(d.label)
      if (existing) {
        labelToId[d.label] = existing.id
        if (mode === 'replace') mergedDims.push(existing)
        continue
      }
      const id = uid()
      mergedDims.push({ id, label: d.label, type: d.type, weight: 20, unit: d.unit, levels: d.levels })
      labelToId[d.label] = id
    }
    // category / flavorLabel 仅在替换模式或尚未设置时更新（避免追加模式覆盖已有类型）
    const nextCategory = mode === 'replace' || !config.category
      ? review?.category ?? config.category
      : config.category
    const nextFlavorLabel = mode === 'replace' || !config.flavorLabel
      ? review?.flavorLabel ?? config.flavorLabel
      : config.flavorLabel
    onConfigChange({ ...config, dims: mergedDims, category: nextCategory, flavorLabel: nextFlavorLabel })
    const newSkus = items.map((r) => toSku(r, labelToId))
    onChange(mode === 'replace' ? newSkus : [...skus, ...newSkus])
    setReview(null)
    setScanPreviews([])
  }

  const pickImage = (files: FileList | null) => {
    if (!files) return
    const imgs = Array.from(files).filter((f) => f.type.startsWith('image/'))
    if (imgs.length > 0) handleImages(imgs)
  }

  const dragging = useGlobalDropPaste(pickImage, setReview)

  const validCount = skus.filter((s) => s.price > 0 && s.quantity > 0 && s.packs > 0).length
  const flavorLabel = config.flavorLabel || inferFlavorLabel(config.category)

  // 分组上色：第一维度（口味/颜色/型号）用行底色，参数维度列用左侧色条
  const flavorColorMap = deriveFlavorColorMap(skus, palette.flavor)
  const dimColorMaps = deriveDimColorMaps(skus, config.dims, palette.groupBar)
  const dimHasGroup = deriveDimHasGroup(dimColorMaps)
  const hasAnyFlavor = skusHaveFlavor(skus)

  return (
    <div className="space-y-6">
      {/* 单位建议：按量纲分组的常用单位（含换算表内新增的体积/长度/计件单位） */}
      <UnitDatalist />

      {/* 拖入全屏高亮遮罩 */}
      <DropOverlay dragging={dragging} />

      {/* 顶部说明 + 快捷操作 */}
      <WorkbenchToolbar
        quickOpen={quickOpen}
        onToggleQuick={() => setQuickOpen((v) => !v)}
        genLoading={genLoading}
        onGenExample={handleGenExample}
        fileRef={fileRef}
        onPickImage={pickImage}
      />

      {/* 极速录入面板：一行一条「规格 价格」，粘贴即解析，入表前先看清谁划算 */}
      <QuickEntryPanel
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        skus={skus}
        onChange={onChange}
        flavorLabel={flavorLabel}
      />

      {/* AI 生成示例：状态提示（独立成行，避免大屏下挤进标题行） */}
      <GenExampleNotice genSummary={genSummary} genError={genError} />

      {/* AI 识别：扫描进度 / 确认修正 */}
      <AnimatePresence mode="wait">
        {scanning && (
          <ScanProgress scanPreviews={scanPreviews} scanElapsed={scanElapsed} onCancel={cancelScan} />
        )}

        {review && !scanning && (
          <RecognizeReview
            key="review"
            images={review.images}
            items={review.items}
            source={review.source}
            note={review.note}
            dims={review.dims}
            category={review.category}
            flavorLabel={review.flavorLabel}
            existingCount={skus.length}
            onConfirm={confirmImport}
            onCancel={() => { setReview(null); setScanPreviews([]) }}
          />
        )}
      </AnimatePresence>

      {/* ============ 参数维度 + 权重面板 ============ */}
      <DimPanel
        config={config}
        onConfigChange={onConfigChange}
        open={dimPanelOpen}
        onToggle={() => setDimPanelOpen(!dimPanelOpen)}
        addDim={addDim}
        updateDim={updateDim}
        removeDim={removeDim}
      />

      {/* SKU 表格：拆口味列 + 可按 口味/重量/数量 分组折叠；无数据时显示快速入门 */}
      <SkusSection
        skus={skus}
        dims={config.dims}
        flavorLabel={flavorLabel}
        groupBy={groupBy}
        onSetGroupBy={setGroupBy}
        collapsed={collapsed}
        onSetCollapsed={setCollapsed}
        onToggleGroup={toggleGroup}
        update={update}
        updateParam={updateParam}
        remove={remove}
        duplicate={duplicate}
        add={add}
        tableRef={tableRef}
        onTableKey={handleTableKey}
        flavorColorMap={flavorColorMap}
        dimColorMaps={dimColorMaps}
        dimHasGroup={dimHasGroup}
        hasAnyFlavor={hasAnyFlavor}
        genLoading={genLoading}
        onGenExample={handleGenExample}
        onPickImage={() => fileRef.current?.click()}
        onQuickEntry={() => setQuickOpen(true)}
      />

      {/* 底部生成 */}
      <GenerateBar validCount={validCount} onGenerate={onGenerate} />
    </div>
  )
}
