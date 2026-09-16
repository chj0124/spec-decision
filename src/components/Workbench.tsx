import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Sku, DecisionConfig, ParamDim, ParamType, ParamValue, PricePoint } from '../lib/types'
import { uid, fmt, isStale, parseFlavor, groupSkus, parseSpec, buildSpec, inferFlavorLabel, UNIT_GROUPS, recordPrice, priceTrend, fmtPointDay } from '../lib/engine'
import type { GroupBy } from '../lib/engine'
import { recognizeImages, toSku } from '../lib/recognize'
import { parseClipboardTable } from '../lib/parseTable'
import { parseQuickEntry, quickEntryToSku, quickEntryUnitPrice } from '../lib/quickEntry'
import type { RecognizeResult } from '../lib/recognize'
import { loadAiConfig, getVisionModel } from '../lib/ai'
import { generateExample } from '../lib/aiSample'
import { deriveFlavorColorMap, deriveDimColorMaps, deriveDimHasGroup, skusHaveFlavor } from '../lib/view-model'
import RecognizeReview from './RecognizeReview'
import WeightPie from './WeightPie'
import {
  Plus, Trash2, ImagePlus, Loader2,
  Sparkles, ArrowRight, UploadCloud, ChevronDown,
  Sliders, PieChart as PieIcon, X, AlertCircle, Scale,
  TrendingUp, TrendingDown, Minus, Copy, Zap, ClipboardList, Check,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

/**
 * 根据内容自动调整宽度的 input。
 * 用一个隐藏的 span（复制 input 的 className 保证字体/padding 一致）测量文本宽度，
 * 把 input 的 width 设为测量值 + 余量。这样维度名、单位、levels 输入框能随内容伸缩，
 * 短文字不浪费空间，长文字不会被截断。
 */
function AutoWidthInput({
  value,
  minWidth = 60,
  extra = 12,
  className = '',
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { minWidth?: number; extra?: number }) {
  const spanRef = useRef<HTMLSpanElement>(null)
  const [w, setW] = useState(minWidth)
  const measure = useCallback(() => {
    const el = spanRef.current
    if (!el) return
    // 用 getBoundingClientRect 取小数宽度再向上取整：offsetWidth 会向下取整，
    // 对 "ml" 这种刚好卡在边界上的短文本会把宽度算少 1~2px，导致末位被裁掉。
    const raw = el.getBoundingClientRect().width
    setW(Math.max(minWidth, Math.ceil(raw) + extra))
  }, [minWidth, extra])
  useEffect(() => {
    measure()
  }, [measure, value, props.placeholder, className])
  // 字体（web font）加载完成前测量会偏小；加载后重测一次，避免首屏宽度不足被截断。
  useEffect(() => {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined
    if (!fonts?.ready) return
    let alive = true
    fonts.ready.then(() => {
      if (alive) measure()
    })
    return () => {
      alive = false
    }
  }, [measure, value, props.placeholder, className])
  return (
    <>
      {/* 测量用隐藏 span：复制 input 的 className（含字体/padding）保证测量准确。
         用 inline style width:auto 强制覆盖 .field 的 w-full，否则 span 撑满父宽度测不准。
         class 级的 w-auto 无法覆盖 @apply w-full（CSS 层级问题），只能靠 inline style。 */}
      <span
        ref={spanRef}
        aria-hidden
        className={`${className} invisible absolute whitespace-pre pointer-events-none inline-block border border-transparent`}
        style={{ width: 'auto', maxWidth: 'none' }}
      >
        {String(value ?? '') || props.placeholder || ''}
      </span>
      <input {...props} value={value} className={className} style={{ width: w }} />
    </>
  )
}

interface Props {
  skus: Sku[]
  onChange: (s: Sku[]) => void
  onGenerate: () => void
  config: DecisionConfig
  onConfigChange: (c: DecisionConfig) => void
}

/** 表头单元格公共样式：吸附在表格滚动容器顶部，实心底避免内容透出 */
const TH_BASE =
  'sticky top-0 z-10 bg-brand-soft border-b border-edge px-3 py-3 font-medium text-left text-sm text-slate-500'

/** 单行 SKU 的派生状态与「口味/规格/含量/单位/数量」双向同步编辑逻辑（桌面表格行与移动端卡片共用） */
function useSkuRow(s: Sku, update: (id: string, patch: Partial<Sku>) => void) {
  const total = s.quantity * Math.max(1, s.packs)
  const up = total > 0 && s.price > 0 ? s.price / total : 0
  // 每件价：整箱商品的直觉单位 ——「这箱 24 瓶、¥49.7，合下来一瓶多少」。
  // 每单位价（每 ml）适合跨规格比，每件价适合判断"这箱到底贵不贵"，两者互补。
  const packPrice = s.price > 0 && s.packs > 0 ? s.price / Math.max(1, s.packs) : 0
  const incomplete = !(s.price > 0 && s.quantity > 0 && s.packs > 0)
  const { flavor, spec } = parseFlavor(s.name)

  const setName = (newFlavor: string, newSpec: string) => {
    const name = newFlavor.trim() ? `${newFlavor.trim()} ${newSpec.trim()}`.trim() : newSpec.trim()
    update(s.id, { name })
  }

  /** 改规格描述 → 同步解析 含量/单位/数量/件数量词 */
  const handleSpec = (newSpec: string) => {
    const parts = parseSpec(newSpec)
    const patch: Partial<Sku> = {}
    if (parts.quantity !== undefined) patch.quantity = parts.quantity
    if (parts.unit) patch.unit = parts.unit
    if (parts.packs !== undefined) patch.packs = parts.packs
    // 量词跟随描述重建：写了"瓶"存"瓶"，没写量词清空（buildSpec 回退默认）
    if (parts.packs !== undefined) patch.packUnit = parts.packUnit ?? ''
    const name = flavor.trim() ? `${flavor.trim()} ${newSpec.trim()}`.trim() : newSpec.trim()
    update(s.id, { ...patch, name })
  }

  /** 改 含量/单位/数量 → 同步重建规格描述 */
  const handleField = (field: 'quantity' | 'unit' | 'packs', value: number | string) => {
    const next = { ...s, [field]: value }
    const spec = buildSpec(next.quantity, next.unit, next.packs, next.packUnit)
    const name = flavor.trim() ? `${flavor.trim()} ${spec}`.trim() : spec
    update(s.id, { [field]: value, name })
  }

  return { total, up, packPrice, incomplete, flavor, spec, setName, handleSpec, handleField }
}

/** 维度值输入控件：按维度类型渲染 数字 / 是否 / 评级（桌面表格行与移动端卡片共用） */
function DimInput({ dim, s, updateParam, className = '' }: {
  dim: ParamDim
  s: Sku
  updateParam: (id: string, dimId: string, value: ParamValue) => void
  className?: string
}) {
  const raw = s.params?.[dim.id]
  if (dim.type === 'boolean') {
    const boolValue = typeof raw === 'string' ? raw : (typeof raw === 'boolean' && raw ? 'yes' : 'no')
    return (
      <select
        value={boolValue}
        onChange={(e) => updateParam(s.id, dim.id, e.target.value)}
        className={`field py-1.5 text-xs min-w-[80px] ${className}`}
      >
        <option value="no">否</option>
        <option value="yes">是</option>
      </select>
    )
  }
  if (dim.type === 'text') {
    const levels = dim.levels ?? []
    return (
      <select
        value={typeof raw === 'string' ? raw : ''}
        onChange={(e) => updateParam(s.id, dim.id, e.target.value)}
        className={`field py-1.5 text-xs min-w-[88px] ${className}`}
      >
        <option value="">—</option>
        {levels.map((lv) => (
          <option key={lv} value={lv}>{lv}</option>
        ))}
      </select>
    )
  }
  // 数值型：higher-better / lower-better
  return (
    <AutoWidthInput
      type="number"
      value={typeof raw === 'number' ? raw : ''}
      onChange={(e) =>
        updateParam(s.id, dim.id, e.target.value === '' ? undefined : parseFloat(e.target.value))
      }
      placeholder={dim.unit ?? '0'}
      minWidth={56} extra={24}
      className={`field py-1.5 text-xs tabular ${className}`}
    />
  )
}

const emptySku = (): Sku => ({
  id: uid(), name: '', price: 0, quantity: 0, unit: 'g', packs: 1,
})

/**
 * 价格走势徽标：只有录到 ≥2 个价格点（跨天变过价）才出现，hover 可看历史明细。
 * 降价用绿色（对买家是好消息），涨价用琥珀色 —— 与报告里的涨跌语义保持一致。
 */
function PriceTrendBadge({ history, className = '' }: { history?: PricePoint[]; className?: string }) {
  const trend = priceTrend(history)
  if (!trend) return null
  const { direction, deltaPct, points } = trend
  const flat = direction === 'flat'
  const down = direction === 'down'
  const Icon = flat ? Minus : down ? TrendingDown : TrendingUp
  const tone = flat ? 'text-slate-400' : down ? 'text-emerald-500' : 'text-amber-500'
  const label = flat ? '持平' : `${down ? '降' : '涨'}${Math.abs(deltaPct).toFixed(1)}%`
  const detail = points.map((p) => `${fmtPointDay(p.t)} ${fmt.yuan(p.price)}`).join(' → ')
  return (
    <span
      title={`价格历史（${points.length} 条）：${detail}`}
      aria-label={`价格${label}`}
      className={`inline-flex items-center gap-0.5 shrink-0 text-[10px] tabular whitespace-nowrap ${tone} ${className}`}
    >
      <Icon className="h-3 w-3 shrink-0" />
      {label}
    </span>
  )
}

/**
 * 价格新鲜度：把"这条价格是什么时候录的"摆到行上。
 * 价格点的时间戳此前只写不读，数据看着永远新鲜；超过 STALE_DAYS 未更新时标琥珀色 + 警示图标，
 * 让"结论可能过期"变得可见。
 */
function PriceAgeBadge({ history, className = '' }: { history?: PricePoint[]; className?: string }) {
  const last = history?.[history.length - 1]
  if (!last) return null
  const stale = isStale(last.t)
  return (
    <span
      title={`价格记录于 ${new Date(last.t).toLocaleString('zh-CN')}`}
      className={`inline-flex items-center gap-0.5 shrink-0 text-[10px] tabular whitespace-nowrap ${
        stale ? 'text-amber-500 font-medium' : 'text-slate-400'
      } ${className}`}
    >
      {stale && <AlertCircle className="h-3 w-3 shrink-0" />}
      {fmt.ago(last.t)}
    </span>
  )
}

// 权重饼图调色板（与图表主题一致的靛蓝主色系）
const PIE_COLORS = ['#4f46e5', '#f59e0b', '#10b981', '#a855f7', '#ef4444', '#0ea5e9', '#ec4899']

const PARAM_TYPE_LABELS: Record<ParamType, string> = {
  'higher-better': '越大越好',
  'lower-better': '越小越好',
  'boolean': '是/否',
  'text': '评级',
}

/**
 * 权重档位：用语义标签替代 0-100 滑块，用户无需纠结具体数值。
 * 档位值参与 scoreItems 的归一化加权（相对比例生效，绝对值无所谓）。
 */
const WEIGHT_TIERS = [
  { label: '忽略', value: 0 },
  { label: '参考', value: 5 },
  { label: '一般', value: 15 },
  { label: '重要', value: 30 },
  { label: '关键', value: 50 },
] as const

/** 数值型维度才需要单位；boolean/text 用不到 */
const isNumericType = (t: ParamType) => t === 'higher-better' || t === 'lower-better'

/** 第一分组维度（口味/颜色/型号）行底色调色板 */
const FLAVOR_COLORS = [
  'bg-sky-100/60 dark:bg-sky-900/20',
  'bg-amber-100/60 dark:bg-amber-900/20',
  'bg-emerald-100/60 dark:bg-emerald-900/20',
  'bg-violet-100/60 dark:bg-violet-900/20',
  'bg-rose-100/60 dark:bg-rose-900/20',
  'bg-cyan-100/60 dark:bg-cyan-900/20',
  'bg-orange-100/60 dark:bg-orange-900/20',
  'bg-teal-100/60 dark:bg-teal-900/20',
]

/** 参数维度列分组色条颜色（inline style） */
const GROUP_BAR_COLORS = [
  '#0ea5e9', '#f59e0b', '#10b981', '#a855f7',
  '#f43f5e', '#06b6d4', '#f97316', '#14b8a6',
]

export default function Workbench({ skus, onChange, onGenerate, config, onConfigChange }: Props) {
  const [scanning, setScanning] = useState(false)
  const [scanPreviews, setScanPreviews] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const [review, setReview] = useState<(RecognizeResult & { images: string[] }) | null>(null)
  const [groupBy, setGroupBy] = useState<GroupBy | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [dimPanelOpen, setDimPanelOpen] = useState(true)
  const [scanElapsed, setScanElapsed] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
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

  // ============ 极速录入：把「一行一条规格」的文字直接贴进来 ============
  // 逐格填一行要动 6 个输入框，但比价的数据源头本来就是文字（商品标题、聊天记录、备忘录）。
  // 让用户先把文字翻译成格子是纯浪费，这里直接把文字贴进来解析成行。
  const [quickOpen, setQuickOpen] = useState(false)
  const [quickText, setQuickText] = useState('')
  const [quickFlavor, setQuickFlavor] = useState('')
  const quickRef = useRef<HTMLDivElement>(null)

  const quickItems = useMemo(
    () => (quickOpen ? parseQuickEntry(quickText, quickFlavor) : []),
    [quickOpen, quickText, quickFlavor],
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
    setQuickOpen(false)
  }

  // 空状态里的入口离面板很远，打开时滚过去，避免用户以为没反应
  useEffect(() => {
    if (quickOpen) quickRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [quickOpen])

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

  // 权重饼图数据：价格 + 所有维度
  const pieData = [
    { name: '价格', value: Math.max(0, config.priceWeight), color: PIE_COLORS[0] },
    ...config.dims.map((d, i) => ({
      name: d.label,
      value: Math.max(0, d.weight),
      color: PIE_COLORS[(i + 1) % PIE_COLORS.length],
    })),
  ].filter((d) => d.value > 0)

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

  // 全局监听器只在挂载时注册一次；用 ref 持有最新的 pickImage（内部依赖 skus / 分组等最新状态），
  // 这样输入数据变化时不会反复卸载重挂 window 事件，也不会因闭包过期而拿到旧 skus。
  const pickImageRef = useRef(pickImage)
  useEffect(() => {
    pickImageRef.current = pickImage
  })

  // 全局拖入 / 粘贴监听
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault()
      dragDepth.current++
      setDragging(true)
    }
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
    }
    const onDragLeave = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragging(false)
    }
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      pickImageRef.current(e.dataTransfer.files)
    }
    const onPaste = (e: ClipboardEvent) => {
      // 优先处理图片（截图粘贴）
      if (e.clipboardData?.files.length) {
        pickImageRef.current(e.clipboardData.files)
        return
      }
      // 没有图片时尝试解析文本表格（Excel/电商页面/Markdown 复制）
      const text = e.clipboardData?.getData('text/plain') ?? ''
      const html = e.clipboardData?.getData('text/html') ?? ''
      if (!text.trim()) return
      const parsed = parseClipboardTable(text, html)
      if (!parsed) return
      if (parsed.items.length === 0) {
        // 解析失败（没识别到价格/名称列），给出提示
        setReview({
          items: [],
          source: 'error',
          note: parsed.note ?? '未能从粘贴内容解析出表格',
          images: [],
        })
        return
      }
      // 解析成功：复用识别确认弹窗，source='api' 避免显示"演示识别"
      setReview({
        items: parsed.items,
        dims: parsed.dims,
        source: 'api',
        note: parsed.note,
        images: [],
      })
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('paste', onPaste)
    }
  }, [])

  const validCount = skus.filter((s) => s.price > 0 && s.quantity > 0 && s.packs > 0).length
  const flavorLabel = config.flavorLabel || inferFlavorLabel(config.category)

  // 分组上色：第一维度（口味/颜色/型号）用行底色，参数维度列用左侧色条
  const flavorColorMap = deriveFlavorColorMap(skus, FLAVOR_COLORS)
  const dimColorMaps = deriveDimColorMaps(skus, config.dims, GROUP_BAR_COLORS)
  const dimHasGroup = deriveDimHasGroup(dimColorMaps)
  const hasAnyFlavor = skusHaveFlavor(skus)

  return (
    <div className="space-y-6">
      {/* 单位建议：按量纲分组的常用单位（含换算表内新增的体积/长度/计件单位） */}
      <datalist id="unit-options">
        {UNIT_GROUPS.flatMap((g) => g.units).map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>

      {/* 拖入全屏高亮遮罩 */}
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

      {/* 顶部说明 + 快捷操作 */}
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
            onClick={() => setQuickOpen((v) => !v)}
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
            onClick={handleGenExample}
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
            onChange={(e) => e.target.files && pickImage(e.target.files)}
          />
        </div>
      </div>

      {/* 极速录入面板：一行一条「规格 价格」，粘贴即解析，入表前先看清谁划算 */}
      <AnimatePresence>
        {quickOpen && (
          <motion.div
            ref={quickRef}
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
                  onClick={() => setQuickOpen(false)}
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

      {/* AI 生成示例：状态提示（独立成行，避免大屏下挤进标题行） */}
      {genSummary && !genError && (
        <div className="flex items-start gap-2 rounded-xl border border-brand/60 bg-brand px-3 py-2.5 text-sm text-white shadow-glow">
          <Sparkles className="h-4 w-4 shrink-0 mt-0.5" />
          <span className="font-medium">{genSummary}</span>
        </div>
      )}
      {genError && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{genError}（可在右上角「AI 设置」中配置后获得每次不同的真实生成结果。）</span>
        </div>
      )}

      {/* AI 识别：扫描进度 / 确认修正 */}
      <AnimatePresence mode="wait">
        {scanning && (
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
              onClick={cancelScan}
              className="px-3 py-1.5 rounded-lg border border-edge text-xs text-slate-500 hover:text-red-400 hover:border-red-400/50 transition-all inline-flex items-center gap-1.5 shrink-0"
              title="取消识别"
            >
              <X className="h-3.5 w-3.5" /> 取消
            </button>
            <style>{`@keyframes scan{0%,100%{top:0}50%{top:calc(100% - 2px)}}`}</style>
          </motion.div>
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
      <div className="glass rounded-2xl overflow-hidden">
        <button
          onClick={() => setDimPanelOpen(!dimPanelOpen)}
          className="w-full px-4 py-3 flex items-center justify-between text-left border-b border-edge bg-brand-soft/40 hover:bg-brand-soft/60 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Sliders className="h-4 w-4 text-brand" />
            <span className="text-sm font-semibold">参数维度与权重</span>
            <span className="text-xs text-slate-500">
              {config.dims.length === 0
                ? '（仅按价格比价，点击展开添加维度）'
                : `共 ${config.dims.length} 个维度 + 价格`}
            </span>
          </div>
          <ChevronDown
            className={`h-4 w-4 text-slate-500 transition-transform ${dimPanelOpen ? '' : '-rotate-90'}`}
          />
        </button>

        <AnimatePresence>
          {dimPanelOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="flex flex-col lg:flex-row gap-4 p-4">
                {/* 左：维度列表 */}
                <div className="flex-1 space-y-2 min-w-0 overflow-x-auto">
                  {/* 价格维度（内置，不可删除） */}
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-brand-soft/30 border border-edge">
                    <span className="text-xs font-mono text-slate-500 w-6">价格</span>
                    <input
                      value="每单位价格"
                      disabled
                      className="field py-1.5 text-xs flex-1 opacity-70"
                    />
                    <span className="text-xs text-slate-500 w-16 text-center">越小越好</span>
                    <div className="flex items-center gap-0.5 rounded-lg bg-panel/60 border border-edge/60 p-0.5">
                      {WEIGHT_TIERS.map((t) => (
                        <button
                          key={t.value}
                          onClick={() => onConfigChange({ ...config, priceWeight: t.value })}
                          className={`px-2 py-1 text-sm rounded transition-all ${
                            config.priceWeight === t.value
                              ? 'bg-brand/20 text-brand font-semibold'
                              : 'text-slate-500 hover:text-brand-deep'
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 用户自定义维度 */}
                  {config.dims.map((dim) => (
                    <div key={dim.id} className="flex items-center gap-2 p-2 rounded-lg border border-edge hover:bg-brand-soft/30 transition-colors">
                      <AutoWidthInput
                        value={dim.label}
                        onChange={(e) => updateDim(dim.id, { label: e.target.value })}
                        placeholder="维度名"
                        minWidth={90}
                        className="field py-1.5 text-xs cursor-text hover:border-brand/60 focus:border-brand focus:ring-1 focus:ring-brand/40"
                      />
                      {isNumericType(dim.type) && (
                        <AutoWidthInput
                          value={dim.unit ?? ''}
                          onChange={(e) => updateDim(dim.id, { unit: e.target.value })}
                          placeholder="单位"
                          minWidth={48}
                          className="field py-1.5 text-xs"
                          title="单位（可选，如 mAh / g / mm）"
                        />
                      )}
                      <select
                        value={dim.type}
                        onChange={(e) => updateDim(dim.id, { type: e.target.value as ParamType })}
                        className="field py-1.5 text-xs min-w-[96px]"
                        title="维度类型"
                      >
                        {Object.entries(PARAM_TYPE_LABELS).map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                      {dim.type === 'text' && (
                        <AutoWidthInput
                          value={(dim.levels ?? []).join(',')}
                          onChange={(e) =>
                            updateDim(dim.id, {
                              levels: e.target.value
                                .split(',')
                                .map((s) => s.trim())
                                .filter(Boolean),
                            })
                          }
                          placeholder="A,B,C"
                          minWidth={56}
                          className="field py-1.5 text-xs"
                          title="评级序列，从优到劣，用逗号分隔"
                        />
                      )}
                      <div className="flex items-center gap-0.5 rounded-lg bg-panel/60 border border-edge/60 p-0.5">
                        {WEIGHT_TIERS.map((t) => (
                          <button
                            key={t.value}
                            onClick={() => updateDim(dim.id, { weight: t.value })}
                            className={`px-2 py-1 text-sm rounded transition-all ${
                              dim.weight === t.value
                                ? 'bg-brand/20 text-brand font-semibold'
                                : 'text-slate-500 hover:text-brand-deep'
                            }`}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => removeDim(dim.id)}
                        className="text-slate-600 hover:text-red-400 transition-colors p-1"
                        aria-label="删除维度"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}

                  <button
                    onClick={addDim}
                    className="w-full py-2 text-xs text-slate-500 hover:text-brand hover:bg-brand-soft/40 rounded-lg transition-all flex items-center justify-center gap-1.5 border border-dashed border-edge"
                  >
                    <Plus className="h-3.5 w-3.5" /> 新增参数维度
                  </button>
                </div>

                {/* 右：权重饼图 */}
                <div className="lg:w-64 shrink-0 flex flex-col items-center justify-center p-2">
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
                    <PieIcon className="h-3.5 w-3.5" /> 权重分布
                  </div>
                  {pieData.length > 0 ? (
                    <WeightPie data={pieData} />
                  ) : (
                    <div className="h-44 grid place-items-center text-xs text-slate-500">
                      所有权重为 0
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2 justify-center">
                    {pieData.map((d, i) => (
                      <span key={i} className="flex items-center gap-1 text-sm text-slate-500">
                        <span className="h-2 w-2 rounded-sm" style={{ background: d.color }} />
                        {d.name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* SKU 表格：拆口味列 + 可按 口味/重量/数量 分组折叠；无数据时显示快速入门 */}
      {skus.length === 0 ? (
        <EmptyState
          genLoading={genLoading}
          onGenExample={handleGenExample}
          onPickImage={() => fileRef.current?.click()}
          onQuickEntry={() => setQuickOpen(true)}
          onAdd={add}
        />
      ) : (
      <div className="glass rounded-2xl overflow-hidden">
        {/* 分组折叠工具栏 */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-edge bg-brand-soft/50 flex-wrap">
          <span className="text-xs text-slate-500">分组折叠：</span>
          {(() => {
            // 动态构建分组选项，并过滤掉无区分意义的（所有 SKU 在该维度值相同）
            const allOptions: Array<{ key: string; label: string; getValue: (s: Sku) => string }> = [
              { key: 'flavor', label: `按${flavorLabel}`, getValue: (s) => parseFlavor(s.name).flavor || '（无）' },
              { key: 'quantity', label: '按规格', getValue: (s) => `${s.quantity}${s.unit}` },
              { key: 'packs', label: '按件数', getValue: (s) => `${s.packs}件` },
              ...config.dims.map((d): { key: string; label: string; getValue: (s: Sku) => string } => ({
                key: `dim:${d.id}`,
                label: `按${d.label}`,
                getValue: (s) => String(s.params?.[d.id] ?? '（未设）'),
              })),
            ]
            // 只保留"能真正聚合成组"的维度：
            // 1) 至少 2 个不同值（否则只有 1 组=无分组意义）
            // 2) 去重后值数量 < SKU 总数（否则每组只有 1 个 SKU=只是排序不是分组）
            const options = allOptions.filter((opt) => {
              if (skus.length < 3) return false
              const values = new Set(skus.map(opt.getValue))
              return values.size > 1 && values.size < skus.length
            })
            if (options.length === 0) return null
            return options.map((opt) => {
              const active = groupBy === opt.key
              return (
                <button
                  key={opt.key}
                  onClick={() => {
                    setCollapsed(new Set())
                    setGroupBy(active ? null : (opt.key as GroupBy))
                  }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                    active
                      ? 'bg-brand/20 text-brand border border-brand/50'
                      : 'text-slate-400 border border-edge hover:text-brand-deep hover:border-brand/40'
                  }`}
                >
                  {opt.label}
                </button>
              )
            })
          })()}
          {groupBy && (
            <button
              onClick={() => { setCollapsed(new Set()); setGroupBy(null) }}
              className="text-xs text-slate-500 hover:text-brand-deep ml-1"
            >
              取消分组
            </button>
          )}
          <span className="text-xs text-slate-400 ml-auto hidden sm:block">
            Enter 跳转下一格 · Ctrl+Enter 快速加行
          </span>
        </div>

        {/* 桌面表格：内部滚动 + 吸附表头；移动端为卡片式录入 */}
        <div className="hidden sm:block overflow-auto max-h-[72vh]">
          <table ref={tableRef} onKeyDown={handleTableKey} className="w-full text-sm min-w-[1040px]">
            <thead>
              <tr>
                <th className={`${TH_BASE} w-8`}>#</th>
                <th className={TH_BASE}>{flavorLabel}</th>
                <th className={TH_BASE}>规格（含量×件数）</th>
                <th className={TH_BASE}>总价 ¥</th>
                <th className={TH_BASE}>单件含量</th>
                <th className={TH_BASE}>计量单位</th>
                <th className={TH_BASE}>件数</th>
                {config.dims.map((dim) => (
                  <th key={dim.id} className={TH_BASE}>
                    {dim.label}
                    {dim.unit && <span className="text-xs text-slate-400 ml-1">({dim.unit})</span>}
                  </th>
                ))}
                <th className={`${TH_BASE} text-right`}>总量</th>
                <th className={`${TH_BASE} text-right`}>每件价</th>
                <th className={`${TH_BASE} text-right`}>每单位价</th>
                <th className={`${TH_BASE} w-16`} />
              </tr>
            </thead>
            {/* key 随 groupBy 变化，切换分组维度时整体重挂载，避免旧分组行残留 */}
            <tbody key={groupBy ?? 'none'}>
              {(groupBy ? groupSkus(skus, groupBy) : [{ key: '__all__', items: skus }]).map(
                (group) => {
                  const isGrouped = groupBy !== null
                  const isCollapsed = collapsed.has(group.key)
                  return (
                    <GroupRows
                      key={group.key}
                      groupKey={group.key}
                      items={group.items}
                      allSkus={skus}
                      isGrouped={isGrouped}
                      isCollapsed={isCollapsed}
                      onToggle={() => toggleGroup(group.key)}
                      update={update}
                      updateParam={updateParam}
                      remove={remove}
                      duplicate={duplicate}
                      dims={config.dims}
                      flavorLabel={flavorLabel}
                      flavorColorMap={flavorColorMap}
                      dimColorMaps={dimColorMaps}
                      dimHasGroup={dimHasGroup}
                      hasAnyFlavor={hasAnyFlavor}
                    />
                  )
                },
              )}
            </tbody>
          </table>
        </div>

        {/* 移动端：卡片式录入（与表格共用分组折叠状态） */}
        <div className="sm:hidden px-3 py-3 space-y-2">
          {(groupBy ? groupSkus(skus, groupBy) : [{ key: '__all__', items: skus }]).map((group) => {
            const isGrouped = groupBy !== null
            const isCollapsed = collapsed.has(group.key)
            return (
              <div key={group.key} className="space-y-2">
                {isGrouped && (
                  <button
                    onClick={() => toggleGroup(group.key)}
                    className="w-full flex items-center gap-2 rounded-lg bg-brand-soft/60 px-3 py-2 text-xs font-semibold text-slate-600 select-none"
                  >
                    <ChevronDown
                      className={`h-3.5 w-3.5 text-brand transition-transform duration-200 ${
                        isCollapsed ? '-rotate-90' : ''
                      }`}
                    />
                    <span className="text-brand">{group.key}</span>
                    <span className="text-slate-500 font-normal">（{group.items.length} 个规格）</span>
                  </button>
                )}
                {!isCollapsed &&
                  group.items.map((s) => {
                    const idx = skus.findIndex((x) => x.id === s.id)
                    return (
                      <SkuRowCard
                        key={s.id}
                        s={s}
                        idx={idx}
                        update={update}
                        updateParam={updateParam}
                        remove={remove}
                        duplicate={duplicate}
                        dims={config.dims}
                        flavorLabel={flavorLabel}
                        flavorColorMap={flavorColorMap}
                        dimColorMaps={dimColorMaps}
                        dimHasGroup={dimHasGroup}
                        hasAnyFlavor={hasAnyFlavor}
                      />
                    )
                  })}
              </div>
            )
          })}
        </div>

        {/* 表尾：添加行 */}
        <button
          onClick={add}
          className="w-full py-3 text-xs text-slate-500 hover:text-brand hover:bg-brand-soft/70 transition-all flex items-center justify-center gap-1.5 border-t border-edge"
        >
          <Plus className="h-4 w-4" /> 添加一行规格
        </button>
      </div>
      )}

      {/* 底部生成 */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 glass rounded-2xl p-5">
        <p className="text-sm text-slate-400">
          已填写 <span className="text-brand font-semibold tabular">{validCount}</span> 个有效规格
          {validCount < 2 && '（至少 2 个才能对比）'}
        </p>
        <button
          onClick={onGenerate}
          disabled={validCount < 2}
          className="w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-brand to-violet-500 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-glow active:scale-[0.98] transition-all"
        >
          生成决策报告 <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

/* ============ 分组折叠行 ============ */

interface GroupRowsProps {
  groupKey: string
  items: Sku[]
  allSkus: Sku[]
  isGrouped: boolean
  isCollapsed: boolean
  onToggle: () => void
  update: (id: string, patch: Partial<Sku>) => void
  updateParam: (id: string, dimId: string, value: ParamValue) => void
  remove: (id: string) => void
  duplicate: (id: string) => void
  dims: ParamDim[]
  flavorLabel: string
  flavorColorMap: Map<string, string>
  dimColorMaps: Map<string, string>[]
  dimHasGroup: boolean[]
  hasAnyFlavor: boolean
}

function GroupRows({ groupKey, items, allSkus, isGrouped, isCollapsed, onToggle, update, updateParam, remove, duplicate, dims, flavorLabel, flavorColorMap, dimColorMaps, dimHasGroup, hasAnyFlavor }: GroupRowsProps) {
  // 列数：# + 口味 + 规格 + 总价 + 含量 + 单位 + 数量 + N个维度 + 总量 + 每件价 + 每单位价 + 操作
  const colCount = 11 + dims.length
  return (
    <>
      {/* 分组标题行（仅分组时显示） */}
      {isGrouped && (
        <tr
          onClick={onToggle}
          className="border-b border-edge bg-brand-soft/60 cursor-pointer hover:bg-brand-soft/70 transition-colors select-none"
        >
          <td colSpan={colCount} className="px-3 py-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
              <ChevronDown
                className={`h-3.5 w-3.5 text-brand transition-transform duration-200 ${
                  isCollapsed ? '-rotate-90' : ''
                }`}
              />
              <span className="text-brand">{groupKey}</span>
              <span className="text-slate-500 font-normal">（{items.length} 个规格）</span>
            </div>
          </td>
        </tr>
      )}

      {/* 数据行 */}
      {!isCollapsed &&
        items.map((s) => {
          const idx = allSkus.findIndex((x) => x.id === s.id)
          return (
            <RowFields
              key={s.id}
              s={s}
              idx={idx}
              update={update}
              updateParam={updateParam}
              remove={remove}
              indented={isGrouped}
              duplicate={duplicate}
              dims={dims}
              flavorLabel={flavorLabel}
              flavorColorMap={flavorColorMap}
              dimColorMaps={dimColorMaps}
              dimHasGroup={dimHasGroup}
              hasAnyFlavor={hasAnyFlavor}
            />
          )
        })}
    </>
  )
}

/* ============ 单行编辑字段（口味 + 规格 拆列） ============ */

interface RowFieldsProps {
  s: Sku
  idx: number
  update: (id: string, patch: Partial<Sku>) => void
  updateParam: (id: string, dimId: string, value: ParamValue) => void
  remove: (id: string) => void
  duplicate: (id: string) => void
  indented: boolean
  dims: ParamDim[]
  flavorLabel: string
  flavorColorMap: Map<string, string>
  dimColorMaps: Map<string, string>[]
  dimHasGroup: boolean[]
  hasAnyFlavor: boolean
}

function RowFields({ s, idx, update, updateParam, remove, duplicate, indented, dims, flavorLabel, flavorColorMap, dimColorMaps, dimHasGroup, hasAnyFlavor }: RowFieldsProps) {
  const { total, up, packPrice, incomplete, flavor, spec, setName, handleSpec, handleField } = useSkuRow(s, update)

  // 同口味行用同底色，仅多口味时上色；待补充行保留警告色
  const flavorBg = !incomplete && hasAnyFlavor && flavor ? flavorColorMap.get(flavor) ?? '' : ''

  return (
    <motion.tr
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className={`border-b border-edge/50 group transition-colors ${
        incomplete ? 'bg-amber-400/[0.03]' : 'hover:bg-brand-soft/50'
      } ${flavorBg}`}
    >
      <td className="px-3 py-2 text-slate-500 font-mono text-xs">
        {indented && <span className="text-edge mr-1">·</span>}
        {String(idx + 1).padStart(2, '0')}
      </td>
      {/* 口味/型号/颜色（根据商品类型自适应） */}
      <td className="px-3 py-2">
        <AutoWidthInput
          value={flavor}
          onChange={(e) => setName(e.target.value, spec)}
          placeholder={flavorLabel}
          minWidth={48}
          className="field py-1.5 text-xs"
        />
      </td>
      {/* 规格（含量×件数），与单件含量/计量单位/件数双向同步 */}
      <td className="px-3 py-2">
        <AutoWidthInput
          value={spec}
          onChange={(e) => handleSpec(e.target.value)}
          placeholder="如 16g×8袋"
          minWidth={80}
          title="改这里会同步 含量/单位/数量"
          className="field py-1.5 text-xs font-medium"
        />
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <AutoWidthInput
            type="number" min={0} step="0.01" value={s.price || ''}
            onChange={(e) => update(s.id, { price: parseFloat(e.target.value) || 0 })}
            placeholder="4.94" minWidth={64} extra={24}
            className="field py-1.5 text-xs tabular"
          />
          <PriceTrendBadge history={s.priceHistory} />
          <PriceAgeBadge history={s.priceHistory} />
        </div>
      </td>
      <td className="px-3 py-2">
        <AutoWidthInput
          type="number" min={0} value={s.quantity || ''}
          onChange={(e) => handleField('quantity', parseFloat(e.target.value) || 0)}
          placeholder="16"
          minWidth={48} extra={24}
          title="改这里会同步规格描述"
          className="field py-1.5 text-xs tabular"
        />
      </td>
      <td className="px-3 py-2">
        <AutoWidthInput
          value={s.unit}
          onChange={(e) => handleField('unit', e.target.value)}
          placeholder="g"
          list="unit-options"
          minWidth={56} extra={24}
          className="field py-1.5 text-xs"
        />
      </td>
      <td className="px-3 py-2">
        <AutoWidthInput
          type="number" min={1} value={s.packs || ''}
          onChange={(e) => handleField('packs', parseInt(e.target.value) || 1)}
          placeholder="8"
          minWidth={48} extra={24}
          title="改这里会同步规格描述"
          className="field py-1.5 text-xs tabular"
        />
      </td>
      {/* 动态维度列：有分组时加左侧色条 */}
      {dims.map((dim, dIdx) => {
        const v = String(s.params?.[dim.id] ?? '')
        const barColor = dimHasGroup[dIdx] ? dimColorMaps[dIdx].get(v) : undefined
        return (
          <td
            key={dim.id}
            className="px-3 py-2"
            style={barColor ? { borderLeft: `3px solid ${barColor}` } : undefined}
          >
            <DimInput dim={dim} s={s} updateParam={updateParam} />
          </td>
        )
      })}
      <td className="px-3 py-2 text-right text-xs text-slate-400 tabular whitespace-nowrap">
        {total > 0 ? `${fmt.num(total)}${s.unit}` : '—'}
      </td>
      {/* 每件价：整箱商品的直觉单位（"这箱 24 瓶 ¥49.7，合一瓶多少"），与每 ml 价互补 */}
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <span className={`text-xs font-semibold tabular ${packPrice > 0 ? 'text-slate-600' : 'text-slate-400'}`}>
          {packPrice > 0 ? fmt.price4(packPrice) : '待补充'}
        </span>
        {packPrice > 0 && <span className="text-sm text-slate-500">/{s.packUnit || '件'}</span>}
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <span className={`text-xs font-semibold tabular ${up > 0 ? 'text-brand' : 'text-slate-600'}`}>
          {up > 0 ? fmt.price4(up) : '待补充'}
        </span>
        {up > 0 && <span className="text-sm text-slate-500">/{s.unit}</span>}
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex items-center justify-end gap-1.5">
          <button
            onClick={() => duplicate(s.id)}
            className="text-slate-600 hover:text-brand transition-colors opacity-0 group-hover:opacity-100"
            aria-label="复制此行"
            title="同款复制：只改规格与价格"
          >
            <Copy className="h-4 w-4" />
          </button>
          <button
            onClick={() => remove(s.id)}
            className="text-slate-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
            aria-label="删除此行"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </td>
    </motion.tr>
  )
}

/* ============ 移动端：单行卡片式录入（与桌面 RowFields 共用 useSkuRow / DimInput） ============ */

interface SkuRowCardProps {
  s: Sku
  idx: number
  update: (id: string, patch: Partial<Sku>) => void
  updateParam: (id: string, dimId: string, value: ParamValue) => void
  remove: (id: string) => void
  duplicate: (id: string) => void
  dims: ParamDim[]
  flavorLabel: string
  flavorColorMap: Map<string, string>
  dimColorMaps: Map<string, string>[]
  dimHasGroup: boolean[]
  hasAnyFlavor: boolean
}

function SkuRowCard({ s, idx, update, updateParam, remove, duplicate, dims, flavorLabel, flavorColorMap, dimColorMaps, dimHasGroup, hasAnyFlavor }: SkuRowCardProps) {
  const { total, up, packPrice, incomplete, flavor, spec, setName, handleSpec, handleField } = useSkuRow(s, update)
  const flavorBg = !incomplete && hasAnyFlavor && flavor ? flavorColorMap.get(flavor) ?? '' : ''

  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className={`rounded-xl border p-3 space-y-2.5 ${
        incomplete ? 'border-amber-400/40 bg-amber-400/[0.03]' : 'border-edge bg-panel/60'
      } ${flavorBg}`}
    >
      {/* 首行：序号 + 口味 + 规格 + 删除 */}
      <div className="flex items-center gap-2">
        <span className="text-slate-400 font-mono text-xs shrink-0">{String(idx + 1).padStart(2, '0')}</span>
        <input
          value={flavor}
          onChange={(e) => setName(e.target.value, spec)}
          placeholder={flavorLabel}
          className="field py-1.5 text-xs flex-1 min-w-0"
        />
        <input
          value={spec}
          onChange={(e) => handleSpec(e.target.value)}
          placeholder="如 16g×8袋"
          title="改这里会同步 含量/单位/数量"
          className="field py-1.5 text-xs font-medium flex-[1.3] min-w-0"
        />
        <button
          onClick={() => duplicate(s.id)}
          className="text-slate-400 hover:text-brand transition-colors shrink-0"
          aria-label="复制此行"
          title="同款复制：只改规格与价格"
        >
          <Copy className="h-4 w-4" />
        </button>
        <button
          onClick={() => remove(s.id)}
          className="text-slate-400 hover:text-red-400 transition-colors shrink-0"
          aria-label="删除此行"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* 数值区：总价 / 含量 / 单位 / 数量 */}
      <div className="grid grid-cols-4 gap-2">
        <label className="block min-w-0">
          <span className="text-[10px] text-slate-400 mb-0.5 flex items-center gap-1">
            总价 ¥
            <PriceTrendBadge history={s.priceHistory} />
            <PriceAgeBadge history={s.priceHistory} />
          </span>
          <input
            type="number" min={0} step="0.01" value={s.price || ''}
            onChange={(e) => update(s.id, { price: parseFloat(e.target.value) || 0 })}
            placeholder="4.94"
            className="field py-1.5 text-xs tabular"
          />
        </label>
        <label className="block min-w-0">
          <span className="text-[10px] text-slate-400 mb-0.5 block">单件含量</span>
          <input
            type="number" min={0} value={s.quantity || ''}
            onChange={(e) => handleField('quantity', parseFloat(e.target.value) || 0)}
            placeholder="16"
            title="改这里会同步规格描述"
            className="field py-1.5 text-xs tabular"
          />
        </label>
        <label className="block min-w-0">
          <span className="text-[10px] text-slate-400 mb-0.5 block">计量单位</span>
          <input
            value={s.unit}
            onChange={(e) => handleField('unit', e.target.value)}
            placeholder="g"
            list="unit-options"
            className="field py-1.5 text-xs"
          />
        </label>
        <label className="block min-w-0">
          <span className="text-[10px] text-slate-400 mb-0.5 block">件数</span>
          <input
            type="number" min={1} value={s.packs || ''}
            onChange={(e) => handleField('packs', parseInt(e.target.value) || 1)}
            placeholder="8"
            title="改这里会同步规格描述"
            className="field py-1.5 text-xs tabular"
          />
        </label>
      </div>

      {/* 参数维度：有分组时带左侧色条 */}
      {dims.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-2">
          {dims.map((dim, dIdx) => {
            const v = String(s.params?.[dim.id] ?? '')
            const barColor = dimHasGroup[dIdx] ? dimColorMaps[dIdx].get(v) : undefined
            return (
              <div
                key={dim.id}
                className="min-w-0"
                style={barColor ? { borderLeft: `3px solid ${barColor}`, paddingLeft: 8 } : undefined}
              >
                <span className="text-[10px] text-slate-400 mb-0.5 block">
                  {dim.label}{dim.unit ? `(${dim.unit})` : ''}
                </span>
                <DimInput dim={dim} s={s} updateParam={updateParam} />
              </div>
            )
          })}
        </div>
      )}

      {/* 底栏：总量 + 每件价 + 每单位价 */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs pt-2 border-t border-edge/50">
        <span className="text-slate-400 tabular">
          {total > 0 ? `总量 ${fmt.num(total)}${s.unit}` : '总量 —'}
        </span>
        {packPrice > 0 && (
          <span className="text-slate-400 tabular">
            每件 {fmt.price4(packPrice)}/{s.packUnit || '件'}
          </span>
        )}
        <span className={`font-semibold tabular ${up > 0 ? 'text-brand' : 'text-slate-400'}`}>
          {up > 0 ? `${fmt.price4(up)}/${s.unit}` : '待补充'}
        </span>
      </div>
    </motion.div>
  )
}

/* ============ 空状态：首次进入的快速入门 ============ */

function EmptyState({ genLoading, onGenExample, onPickImage, onQuickEntry, onAdd }: {
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
