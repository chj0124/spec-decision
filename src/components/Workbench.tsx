import { useEffect, useRef, useState } from 'react'
import type { Sku, DecisionConfig, ParamDim, ParamType, ParamValue } from '../lib/types'
import { uid, fmt, parseFlavor, groupSkus, parseSpec, buildSpec } from '../lib/engine'
import type { GroupBy } from '../lib/engine'
import { recognizeImage, toSku } from '../lib/recognize'
import type { RecognizeResult } from '../lib/recognize'
import { loadAiConfig, getVisionModel } from '../lib/ai'
import RecognizeReview from './RecognizeReview'
import {
  Plus, Trash2, ImagePlus, Loader2,
  Cookie, Smartphone, ArrowRight, UploadCloud, ChevronDown,
  Sliders, PieChart as PieIcon, X,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'

interface Props {
  skus: Sku[]
  onChange: (s: Sku[]) => void
  onGenerate: () => void
  config: DecisionConfig
  onConfigChange: (c: DecisionConfig) => void
  onLoadScene: (scene: 'snack' | 'phone') => void
}

const emptySku = (): Sku => ({
  id: uid(), name: '', price: 0, quantity: 0, unit: 'g', packs: 1,
})

// 权重饼图调色板
const PIE_COLORS = ['#16a34a', '#0ea5e9', '#f59e0b', '#a855f7', '#ef4444', '#14b8a6', '#ec4899']

const PARAM_TYPE_LABELS: Record<ParamType, string> = {
  'higher-better': '越大越好',
  'lower-better': '越小越好',
  'boolean': '是/否',
  'text': '评级',
}

export default function Workbench({ skus, onChange, onGenerate, config, onConfigChange, onLoadScene }: Props) {
  const [scanning, setScanning] = useState(false)
  const [scanPreview, setScanPreview] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [review, setReview] = useState<(RecognizeResult & { image: string }) | null>(null)
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
    onChange(skus.map((s) => (s.id === id ? { ...s, ...patch } : s)))

  /** 更新某个 SKU 的某个 param 维度值 */
  const updateParam = (id: string, dimId: string, value: ParamValue) =>
    onChange(skus.map((s) =>
      s.id === id ? { ...s, params: { ...(s.params ?? {}), [dimId]: value } } : s,
    ))

  const remove = (id: string) => onChange(skus.filter((s) => s.id !== id))
  const add = () => onChange([...skus, emptySku()])
  const loadScene = (scene: 'snack' | 'phone') => onLoadScene(scene)

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

  // AI 截图识别：调用识别服务 → 进入确认环节（可修正）→ 确认后才导入
  const handleImage = async (file: File) => {
    if (!file.type.startsWith('image/')) return
    const url = URL.createObjectURL(file)
    setScanPreview(url)
    setScanning(true)
    setReview(null)
    setScanElapsed(0)
    // 启动计时器，每秒更新等待时长
    scanTimerRef.current = setInterval(() => setScanElapsed((s) => s + 1), 1000)
    try {
      const result = await recognizeImage(file)
      setReview({ ...result, image: url })
    } finally {
      if (scanTimerRef.current) {
        clearInterval(scanTimerRef.current)
        scanTimerRef.current = null
      }
      setScanning(false)
    }
  }

  // 取消扫描（关闭扫描面板）
  const cancelScan = () => {
    if (scanTimerRef.current) {
      clearInterval(scanTimerRef.current)
      scanTimerRef.current = null
    }
    setScanning(false)
    setScanPreview(null)
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
    onConfigChange({ ...config, dims: mergedDims })
    const newSkus = items.map((r) => toSku(r, labelToId))
    onChange(mode === 'replace' ? newSkus : [...skus, ...newSkus])
    setReview(null)
    setScanPreview(null)
  }

  const pickImage = (files: FileList | null) => {
    if (!files) return
    const img = Array.from(files).find((f) => f.type.startsWith('image/'))
    if (img) handleImage(img)
  }

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
      pickImage(e.dataTransfer.files)
    }
    const onPaste = (e: ClipboardEvent) => {
      if (e.clipboardData?.files.length) pickImage(e.clipboardData.files)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skus])

  const validCount = skus.filter((s) => s.price > 0 && s.quantity > 0 && s.packs > 0).length

  return (
    <div className="space-y-6">
      {/* 拖入全屏高亮遮罩 */}
      <AnimatePresence>
        {dragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 grid place-items-center bg-ink/70 light:bg-slate-900/40 backdrop-blur-sm pointer-events-none"
          >
            <div className="rounded-3xl border-2 border-dashed border-cyan-glow/70 bg-panel/80 px-12 py-10 text-center shadow-glow">
              <UploadCloud className="h-12 w-12 mx-auto text-cyan-glow mb-3 animate-bounce" />
              <p className="text-lg font-bold text-cyan-glow">松开鼠标，AI 识别截图</p>
              <p className="text-xs text-slate-400 mt-1">自动提取规格与价格</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 顶部说明 + 快捷操作 */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tighter">
            录入规格，
            <span className="text-cyan-glow">揪出最划算的</span>
          </h2>
          <p className="mt-2 text-sm text-slate-400 max-w-xl leading-relaxed">
            把每个购买选项的名字、价格、单件含量与件数填进来，系统自动换算每单位价格，并结合附加参数给出推荐。
          </p>
          <p className="mt-1.5 text-xs text-slate-500 flex items-center gap-1.5">
            <UploadCloud className="h-3.5 w-3.5 text-cyan-glow/70" />
            也可以直接把商品截图<b className="text-slate-600 font-medium">拖到页面任意位置</b>，或截图后按
            <kbd className="px-1.5 py-0.5 rounded border border-edge bg-brand-soft/60 text-[10px] font-mono">Ctrl+V</kbd>
            粘贴识别
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => loadScene('snack')}
            className="px-3 py-2 rounded-lg border border-edge text-xs font-medium text-slate-600 hover:border-cyan-glow/50 hover:text-cyan-glow transition-all flex items-center gap-1.5"
          >
            <Cookie className="h-3.5 w-3.5" /> 零食示例
          </button>
          <button
            onClick={() => loadScene('phone')}
            className="px-3 py-2 rounded-lg border border-edge text-xs font-medium text-slate-600 hover:border-cyan-glow/50 hover:text-cyan-glow transition-all flex items-center gap-1.5"
          >
            <Smartphone className="h-3.5 w-3.5" /> 手机示例
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="px-3 py-2 rounded-lg bg-gradient-to-r from-cyan-glow/20 to-sky-500/20 border border-cyan-glow/40 text-xs font-semibold text-cyan-glow hover:shadow-glow transition-all flex items-center gap-1.5"
          >
            <ImagePlus className="h-3.5 w-3.5" /> AI 截图识别
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleImage(e.target.files[0])}
          />
        </div>
      </div>

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
            {scanPreview && (
              <div className="relative h-16 w-16 rounded-lg overflow-hidden border border-edge shrink-0">
                <img src={scanPreview} alt="扫描" className="h-full w-full object-cover" />
                <div className="absolute inset-0 bg-cyan-glow/10">
                  <div className="absolute inset-x-0 h-0.5 bg-cyan-glow shadow-glow animate-[scan_1.2s_ease-in-out_infinite]" />
                </div>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-sm text-cyan-glow">
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                <span>AI 正在识别图片中的所有规格与价格…</span>
              </div>
              <div className="mt-1.5 flex items-center gap-3 text-[11px] text-slate-500">
                <span className="tabular">已等待 <span className={scanElapsed > 30 ? 'text-amber-400 font-semibold' : 'text-cyan-glow'}>{scanElapsed}</span> 秒</span>
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
            image={review.image}
            items={review.items}
            source={review.source}
            note={review.note}
            dims={review.dims}
            category={review.category}
            existingCount={skus.length}
            onConfirm={confirmImport}
            onCancel={() => { setReview(null); setScanPreview(null) }}
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
            <Sliders className="h-4 w-4 text-cyan-glow" />
            <span className="text-sm font-semibold">参数维度与权重</span>
            <span className="text-[11px] text-slate-500">
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
                <div className="flex-1 space-y-2 min-w-0">
                  {/* 价格维度（内置，不可删除） */}
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-brand-soft/30 border border-edge">
                    <span className="text-xs font-mono text-slate-500 w-6">价格</span>
                    <input
                      value="每单位价格"
                      disabled
                      className="field py-1.5 text-xs flex-1 opacity-70"
                    />
                    <span className="text-[10px] text-slate-500 w-16 text-center">越小越好</span>
                    <input
                      type="range" min={0} max={100}
                      value={config.priceWeight}
                      onChange={(e) => onConfigChange({ ...config, priceWeight: parseInt(e.target.value) })}
                      className="flex-1 min-w-[80px] accent-cyan-glow"
                    />
                    <span className="text-xs tabular text-cyan-glow w-8 text-right">{config.priceWeight}</span>
                  </div>

                  {/* 用户自定义维度 */}
                  {config.dims.map((dim) => (
                    <div key={dim.id} className="flex items-center gap-2 p-2 rounded-lg border border-edge hover:bg-brand-soft/30 transition-colors">
                      <input
                        value={dim.label}
                        onChange={(e) => updateDim(dim.id, { label: e.target.value })}
                        placeholder="维度名（如 电池容量）"
                        className="field py-1.5 text-xs flex-1 min-w-0"
                      />
                      <input
                        value={dim.unit ?? ''}
                        onChange={(e) => updateDim(dim.id, { unit: e.target.value })}
                        placeholder="单位"
                        className="field py-1.5 text-xs w-14"
                        title="单位（可选，如 mAh）"
                      />
                      <select
                        value={dim.type}
                        onChange={(e) => updateDim(dim.id, { type: e.target.value as ParamType })}
                        className="field py-1.5 text-xs w-20"
                        title="维度类型"
                      >
                        {Object.entries(PARAM_TYPE_LABELS).map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                      {dim.type === 'text' && (
                        <input
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
                          className="field py-1.5 text-xs w-24"
                          title="评级序列，从优到劣，用逗号分隔"
                        />
                      )}
                      <input
                        type="range" min={0} max={100}
                        value={dim.weight}
                        onChange={(e) => updateDim(dim.id, { weight: parseInt(e.target.value) })}
                        className="flex-1 min-w-[80px] accent-cyan-glow"
                      />
                      <span className="text-xs tabular text-cyan-glow w-8 text-right">{dim.weight}</span>
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
                    className="w-full py-2 text-xs text-slate-500 hover:text-cyan-glow hover:bg-brand-soft/40 rounded-lg transition-all flex items-center justify-center gap-1.5 border border-dashed border-edge"
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
                    <div className="w-full h-44">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={pieData}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            outerRadius={70}
                            innerRadius={36}
                            paddingAngle={2}
                          >
                            {pieData.map((entry, idx) => (
                              <Cell key={idx} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{
                              backgroundColor: '#0f1626',
                              border: '1px solid #1c2740',
                              borderRadius: '10px',
                              fontSize: '12px',
                              color: '#e2e8f0',
                            }}
                            labelStyle={{ color: '#e2e8f0', marginBottom: '4px' }}
                            itemStyle={{ color: '#e2e8f0' }}
                            formatter={(v: number) => `${v}`}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="h-44 grid place-items-center text-xs text-slate-500">
                      所有权重为 0
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2 justify-center">
                    {pieData.map((d, i) => (
                      <span key={i} className="flex items-center gap-1 text-[10px] text-slate-500">
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

      {/* SKU 表格：拆口味列 + 可按 口味/重量/数量 分组折叠 */}
      <div className="glass rounded-2xl overflow-hidden">
        {/* 分组折叠工具栏 */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-edge bg-brand-soft/50 flex-wrap">
          <span className="text-[11px] text-slate-500">分组折叠：</span>
          {(['flavor', 'quantity', 'packs'] as GroupBy[]).map((g) => {
            const label = g === 'flavor' ? '按口味' : g === 'quantity' ? '按重量' : '按数量'
            const active = groupBy === g
            return (
              <button
                key={g}
                onClick={() => {
                  setCollapsed(new Set()) // 切换维度时重置折叠状态
                  setGroupBy(active ? null : g)
                }}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                  active
                    ? 'bg-cyan-glow/20 text-cyan-glow border border-cyan-glow/50'
                    : 'text-slate-400 border border-edge hover:text-brand-deep hover:border-slate-600'
                }`}
              >
                {label}
              </button>
            )
          })}
          {groupBy && (
            <button
              onClick={() => { setCollapsed(new Set()); setGroupBy(null) }}
              className="text-[11px] text-slate-500 hover:text-slate-600 ml-1"
            >
              取消分组
            </button>
          )}
          <span className="text-[10px] text-slate-600 ml-auto hidden sm:block">
            折叠后只看不关心的维度，聚焦对比
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[960px]">
            <thead>
              <tr className="border-b border-edge text-left text-[11px] text-slate-500">
                <th className="px-3 py-3 font-medium w-8">#</th>
                <th className="px-3 py-3 font-medium w-28">口味</th>
                <th className="px-3 py-3 font-medium min-w-[150px]">规格（重量×数量）</th>
                <th className="px-3 py-3 font-medium w-24">总价 ¥</th>
                <th className="px-3 py-3 font-medium w-24">单件含量</th>
                <th className="px-3 py-3 font-medium w-16">单位</th>
                <th className="px-3 py-3 font-medium w-20">数量</th>
                {config.dims.map((dim) => (
                  <th key={dim.id} className="px-3 py-3 font-medium w-24">
                    {dim.label}
                    {dim.unit && <span className="text-[10px] text-slate-500 ml-1">({dim.unit})</span>}
                  </th>
                ))}
                <th className="px-3 py-3 font-medium w-24 text-right">总量</th>
                <th className="px-3 py-3 font-medium w-32 text-right">每单位价</th>
                <th className="px-3 py-3 font-medium w-10" />
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
                      dims={config.dims}
                    />
                  )
                },
              )}
            </tbody>
          </table>
        </div>

        {/* 表尾：添加行 */}
        <button
          onClick={add}
          className="w-full py-3 text-xs text-slate-500 hover:text-cyan-glow hover:bg-brand-soft/70 transition-all flex items-center justify-center gap-1.5 border-t border-edge"
        >
          <Plus className="h-4 w-4" /> 添加一行规格
        </button>
      </div>

      {/* 底部生成 */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 glass rounded-2xl p-5">
        <p className="text-sm text-slate-400">
          已填写 <span className="text-cyan-glow font-semibold tabular">{validCount}</span> 个有效规格
          {validCount < 2 && '（至少 2 个才能对比）'}
        </p>
        <button
          onClick={onGenerate}
          disabled={validCount < 2}
          className="w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-brand to-emerald-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-glow active:scale-[0.98] transition-all"
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
  dims: ParamDim[]
}

function GroupRows({ groupKey, items, allSkus, isGrouped, isCollapsed, onToggle, update, updateParam, remove, dims }: GroupRowsProps) {
  // 列数：# + 口味 + 规格 + 总价 + 含量 + 单位 + 数量 + N个维度 + 总量 + 单价 + 操作
  const colCount = 10 + dims.length
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
                className={`h-3.5 w-3.5 text-cyan-glow transition-transform duration-200 ${
                  isCollapsed ? '-rotate-90' : ''
                }`}
              />
              <span className="text-cyan-glow">{groupKey}</span>
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
              dims={dims}
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
  indented: boolean
  dims: ParamDim[]
}

function RowFields({ s, idx, update, updateParam, remove, indented, dims }: RowFieldsProps) {
  const total = s.quantity * Math.max(1, s.packs)
  const up = total > 0 && s.price > 0 ? s.price / total : 0
  const incomplete = !(s.price > 0 && s.quantity > 0 && s.packs > 0)
  const { flavor, spec } = parseFlavor(s.name)

  const setName = (newFlavor: string, newSpec: string) => {
    const name = newFlavor.trim() ? `${newFlavor.trim()} ${newSpec.trim()}`.trim() : newSpec.trim()
    update(s.id, { name })
  }

  /** 改规格描述 → 同步解析 含量/单位/数量 */
  const handleSpec = (newSpec: string) => {
    const parts = parseSpec(newSpec)
    const patch: Partial<Sku> = {}
    if (parts.quantity !== undefined) patch.quantity = parts.quantity
    if (parts.unit) patch.unit = parts.unit
    if (parts.packs !== undefined) patch.packs = parts.packs
    const name = flavor.trim() ? `${flavor.trim()} ${newSpec.trim()}`.trim() : newSpec.trim()
    update(s.id, { ...patch, name })
  }

  /** 改 含量/单位/数量 → 同步重建规格描述 */
  const handleField = (field: 'quantity' | 'unit' | 'packs', value: number | string) => {
    const next = { ...s, [field]: value }
    const spec = buildSpec(next.quantity, next.unit, next.packs)
    const name = flavor.trim() ? `${flavor.trim()} ${spec}`.trim() : spec
    update(s.id, { [field]: value, name })
  }

  /** 渲染某个维度对应的输入控件 */
  const renderDimInput = (dim: ParamDim) => {
    const raw = s.params?.[dim.id]
    if (dim.type === 'boolean') {
      const boolValue = typeof raw === 'string' ? raw : (typeof raw === 'boolean' && raw ? 'yes' : 'no')
      return (
        <select
          value={boolValue}
          onChange={(e) => updateParam(s.id, dim.id, e.target.value)}
          className="field py-1.5 text-xs w-full"
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
          className="field py-1.5 text-xs w-full"
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
      <input
        type="number"
        value={typeof raw === 'number' ? raw : ''}
        onChange={(e) =>
          updateParam(s.id, dim.id, e.target.value === '' ? undefined : parseFloat(e.target.value))
        }
        placeholder={dim.unit ?? '0'}
        className="field py-1.5 text-xs tabular w-full"
      />
    )
  }

  return (
    <motion.tr
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className={`border-b border-edge/50 group transition-colors ${
        incomplete ? 'bg-amber-400/[0.03]' : 'hover:bg-brand-soft/50'
      }`}
    >
      <td className="px-3 py-2 text-slate-500 font-mono text-xs">
        {indented && <span className="text-edge mr-1">·</span>}
        {String(idx + 1).padStart(2, '0')}
      </td>
      {/* 口味 */}
      <td className="px-3 py-2">
        <input
          value={flavor}
          onChange={(e) => setName(e.target.value, spec)}
          placeholder="口味"
          className="field py-1.5 text-xs"
        />
      </td>
      {/* 规格（重量×数量），与含量/单位/数量双向同步 */}
      <td className="px-3 py-2">
        <input
          value={spec}
          onChange={(e) => handleSpec(e.target.value)}
          placeholder="如 16g×8袋"
          title="改这里会同步 含量/单位/数量"
          className="field py-1.5 text-xs font-medium"
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="number" min={0} step="0.01" value={s.price || ''}
          onChange={(e) => update(s.id, { price: parseFloat(e.target.value) || 0 })}
          placeholder="4.94" className="field py-1.5 text-xs tabular"
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="number" min={0} value={s.quantity || ''}
          onChange={(e) => handleField('quantity', parseFloat(e.target.value) || 0)}
          placeholder="16"
          title="改这里会同步规格描述"
          className="field py-1.5 text-xs tabular"
        />
      </td>
      <td className="px-3 py-2">
        <input
          value={s.unit}
          onChange={(e) => handleField('unit', e.target.value)}
          placeholder="g" className="field py-1.5 text-xs"
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="number" min={1} value={s.packs || ''}
          onChange={(e) => handleField('packs', parseInt(e.target.value) || 1)}
          placeholder="8"
          title="改这里会同步规格描述"
          className="field py-1.5 text-xs tabular"
        />
      </td>
      {/* 动态维度列 */}
      {dims.map((dim) => (
        <td key={dim.id} className="px-3 py-2">
          {renderDimInput(dim)}
        </td>
      ))}
      <td className="px-3 py-2 text-right text-xs text-slate-400 tabular whitespace-nowrap">
        {total > 0 ? `${fmt.num(total)}${s.unit}` : '—'}
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <span className={`text-xs font-semibold tabular ${up > 0 ? 'text-cyan-glow' : 'text-slate-600'}`}>
          {up > 0 ? fmt.price4(up) : '待补充'}
        </span>
        {up > 0 && <span className="text-[10px] text-slate-500">/{s.unit}</span>}
      </td>
      <td className="px-3 py-2 text-right">
        <button
          onClick={() => remove(s.id)}
          className="text-slate-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
          aria-label="删除此行"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </td>
    </motion.tr>
  )
}
