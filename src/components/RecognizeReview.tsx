import { useState } from 'react'
import type { RecognizedSku, RecognizedDim } from '../lib/recognize'
import { LOW_CONFIDENCE } from '../lib/recognize'
import { parseFlavor, parseSpec, buildSpec, inferFlavorLabel } from '../lib/engine'
import type { ParamType } from '../lib/types'
import { AlertCircle, Plus, Trash2, CheckCheck, RotateCcw, Info, Tag, Sliders } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface Props {
  /** 单张或多张识别截图（批量识别时显示缩略图列表） */
  images: string[]
  items: RecognizedSku[]
  source: 'api' | 'demo' | 'error'
  note?: string
  /** AI 识别到的商品类型，如"手机" */
  category?: string
  /** AI 建议的"口味列"列名（如"口味"/"型号"/"颜色"），优先于本地推断 */
  flavorLabel?: string
  /** AI 识别到的参数维度定义 */
  dims?: RecognizedDim[]
  /** 工作台已有规格数量；>0 时提供「替换/追加」两种导入方式 */
  existingCount?: number
  onConfirm: (items: RecognizedSku[], dims: RecognizedDim[] | undefined, mode: 'replace' | 'append') => void
  onCancel: () => void
}

const PARAM_TYPE_LABEL: Record<ParamType, string> = {
  'higher-better': '↑',
  'lower-better': '↓',
  'boolean': '✓',
  'text': 'A',
}

/** 口味分组底色调色板：浅色，弱识别度，不影响阅读 */
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

/** 参数维度列分组色条颜色（纯色值，用于 inline style 左侧色条） */
const GROUP_BAR_COLORS = [
  '#0ea5e9', '#f59e0b', '#10b981', '#a855f7',
  '#f43f5e', '#06b6d4', '#f97316', '#14b8a6',
]

const blank = (): RecognizedSku => ({
  name: '', price: 0, quantity: 0, unit: 'g', packs: 1, confidence: 1,
})

export default function RecognizeReview({
  images, items, source, note, category, flavorLabel: aiFlavorLabel, dims, existingCount = 0, onConfirm, onCancel,
}: Props) {
  const isBatch = images.length > 1
  const [rows, setRows] = useState<RecognizedSku[]>(items)
  // 维度也可编辑（用户可改 label / 删除 / 加维度）
  const [dimRows, setDimRows] = useState<RecognizedDim[]>(dims ?? [])

  const update = (i: number, patch: Partial<RecognizedSku>) =>
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch, confidence: 1 } : r)))

  /** 改某行某维度的值 */
  const updateParam = (i: number, label: string, value: string) => {
    setRows(rows.map((r, idx) => {
      if (idx !== i) return r
      const params = { ...(r.params ?? {}) }
      if (value === '') delete params[label]
      else {
        const n = Number(value)
        params[label] = !isNaN(n) && value !== '' ? n : value
      }
      return { ...r, params, confidence: 1 }
    }))
  }

  const updateDim = (i: number, patch: Partial<RecognizedDim>) =>
    setDimRows(dimRows.map((d, idx) => (idx === i ? { ...d, ...patch } : d)))
  const removeDim = (i: number) => setDimRows(dimRows.filter((_, idx) => idx !== i))
  const addDim = () => setDimRows([...dimRows, { label: '新维度', type: 'higher-better' }])

  /** 改「口味」或「规格描述」时，重拼完整名称 */
  const setNameParts = (i: number, flavor: string, spec: string) => {
    const f = flavor.trim()
    const name = f ? `${f} ${spec.trim()}`.trim() : spec.trim()
    update(i, { name })
  }

  /** 改「规格描述」：同步解析出 含量/单位/数量 */
  const setSpec = (i: number, spec: string) => {
    const r = rows[i]
    const { flavor } = parseFlavor(r.name)
    const parts = parseSpec(spec)
    const patch: Partial<RecognizedSku> = {}
    if (parts.quantity !== undefined) patch.quantity = parts.quantity
    if (parts.unit) patch.unit = parts.unit
    if (parts.packs !== undefined) patch.packs = parts.packs
    setRows(rows.map((row, idx) => {
      if (idx !== i) return row
      const name = flavor ? `${flavor} ${spec.trim()}`.trim() : spec.trim()
      return { ...row, ...patch, name, confidence: 1 }
    }))
  }

  /** 改「含量/单位/数量」：同步重建规格描述 */
  const setField = (i: number, field: 'quantity' | 'unit' | 'packs', value: number | string) => {
    setRows(rows.map((row, idx) => {
      if (idx !== i) return row
      const next = { ...row, [field]: value, confidence: 1 }
      const { flavor } = parseFlavor(row.name)
      const spec = buildSpec(next.quantity, next.unit, next.packs)
      const name = flavor ? `${flavor} ${spec}`.trim() : spec
      return { ...next, name }
    }))
  }

  const remove = (i: number) => setRows(rows.filter((_, idx) => idx !== i))
  const add = () => setRows([...rows, blank()])
  // 重置：创建新数组确保 React 检测到引用变化（传入同一引用 React 不触发更新）
  const reset = () => { setRows(items.map((r) => ({ ...r }))); setDimRows((dims ?? []).map((d) => ({ ...d }))) }

  const lowCount = rows.filter((r) => r.confidence < LOW_CONFIDENCE).length
  const valid = rows.filter((r) => r.name.trim() && r.price > 0 && r.quantity > 0 && r.packs > 0)
  const hasDims = dimRows.length > 0
  const flavorLabel = aiFlavorLabel || inferFlavorLabel(category)

  // 动态列宽：基础字段占 12 列中的 11 列，每个 param 维度挤一点
  // 简化处理：param 维度多时整行改为可横向滚动
  const paramCols = dimRows.length

  // 口味分组底色：按 flavor 值稳定映射到调色板，相同口味用同色
  const flavorColorMap = new Map<string, string>()
  let flavorColorIdx = 0
  for (const r of rows) {
    const f = parseFlavor(r.name).flavor || ''
    if (f && !flavorColorMap.has(f)) {
      flavorColorMap.set(f, FLAVOR_COLORS[flavorColorIdx % FLAVOR_COLORS.length])
      flavorColorIdx++
    }
  }

  // 每个参数维度列也独立分组：value → 色条颜色。仅当该列有 ≥2 个不同值时才上色条。
  const dimColorMaps = dimRows.map((d) => {
    const map = new Map<string, string>()
    let idx = 0
    for (const r of rows) {
      const v = String(r.params?.[d.label] ?? '')
      if (v && !map.has(v)) {
        map.set(v, GROUP_BAR_COLORS[idx % GROUP_BAR_COLORS.length])
        idx++
      }
    }
    return map
  })
  // 某参数维度列是否有分组意义（出现 ≥2 个不同值）
  const dimHasGroup = dimColorMaps.map((m) => m.size >= 2)

  // 检测哪些列所有行取值完全相同 → 这些列折叠，在表格上方统一说明
  // 覆盖：单位、数量、含量、规格描述、价格、各参数维度列
  const allSame = (getVal: (r: RecognizedSku) => string | number | undefined) =>
    rows.length > 1 && rows.every((r) => getVal(r) === getVal(rows[0]))
  const commonUnit = allSame((r) => r.unit) ? rows[0].unit : null
  const commonPacks = allSame((r) => r.packs) ? rows[0].packs : null
  const commonQuantity = allSame((r) => r.quantity) ? rows[0].quantity : null
  // 规格描述全同：含量+单位+数量都一致即视为全同（parseSpec 拼出来必然一致），用 quantity+unit+packs 判定
  const commonSpec = commonQuantity && commonUnit && commonPacks
    ? `${commonQuantity}${commonUnit}×${commonPacks}袋` : null
  const commonPrice = allSame((r) => r.price) ? rows[0].price : null
  // 每个参数维度列是否全同
  const commonDimValues = dimRows.map((d) => allSame((r) => String(r.params?.[d.label] ?? '')) ? String(rows[0].params?.[d.label] ?? '') : null)
  // 是否所有行都无口味（即纯规格商品）→ 不需要分组底色
  const hasAnyFlavor = rows.some((r) => parseFlavor(r.name).flavor)
  // 收集所有折叠列的说明文案
  const foldedNotes: string[] = []
  if (commonUnit) foldedNotes.push(`单位「${commonUnit}」`)
  if (commonPacks) foldedNotes.push(`数量「${commonPacks}件」`)
  if (commonQuantity) foldedNotes.push(`含量「${commonQuantity}」`)
  if (commonPrice) foldedNotes.push(`总价「¥${commonPrice}」`)
  dimRows.forEach((d, i) => {
    if (commonDimValues[i]) foldedNotes.push(`${d.label}「${commonDimValues[i]}」`)
  })

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass rounded-3xl p-5 sm:p-6 space-y-5"
    >
      {/* 头部 */}
      <div className="flex flex-col sm:flex-row gap-4 sm:items-start">
        {/* 缩略图：单图直接显示，多图横排带序号角标 */}
        <div className={`shrink-0 ${isBatch ? 'flex gap-1.5 max-w-[280px] overflow-x-auto' : 'h-20 w-20'}`}>
          {images.map((img, i) => (
            <div
              key={i}
              className={`relative rounded-xl overflow-hidden border border-edge shrink-0 ${isBatch ? 'h-16 w-16' : 'h-full w-full'}`}
              title={`截图 ${i + 1}`}
            >
              <img src={img} alt={`识别截图 ${i + 1}`} className="h-full w-full object-cover" />
              {isBatch && (
                <span className="absolute top-0.5 left-0.5 text-[9px] px-1 rounded bg-ink/70 text-cyan-glow font-mono font-bold">
                  {i + 1}
                </span>
              )}
            </div>
          ))}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-bold tracking-tight flex items-center gap-2 flex-wrap">
            {source === 'error' ? '识别失败' : isBatch ? '批量识别结果' : '确认识别结果'}
            {source !== 'error' && (
              <span className="text-sm px-2 py-0.5 rounded-full bg-cyan-glow/15 text-cyan-glow font-semibold">
                {rows.length} 个规格
              </span>
            )}
            {isBatch && source !== 'error' && (
              <span className="text-sm px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-500 font-semibold">
                {images.length} 张图
              </span>
            )}
            {category && source !== 'error' && (
              <span className="text-sm px-2 py-0.5 rounded-full bg-brand-soft border border-edge text-slate-600 font-medium inline-flex items-center gap-1">
                <Tag className="h-3 w-3" /> {category}
              </span>
            )}
            {hasDims && source !== 'error' && (
              <span className="text-sm px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 font-medium inline-flex items-center gap-1">
                <Sliders className="h-3 w-3" /> {paramCols} 个参数维度
              </span>
            )}
          </h3>
          {source === 'error' ? (
            <div className="mt-2 rounded-xl border border-red-400/40 bg-red-500/10 p-3 flex gap-2">
              <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-red-600 mb-1">视觉模型调用失败</p>
                <p className="text-sm text-red-500 leading-relaxed break-all">{note}</p>
                <p className="text-sm text-slate-500 mt-2">
                  请到「AI 设置」检查配置：
                  <br />1. Base URL / API Key 是否正确
                  <br />2. 视觉模型（Vision Model）是否填了支持视觉的模型，如 <code className="font-mono text-cyan-glow">qwen-vl-plus</code> / <code className="font-mono text-cyan-glow">glm-4v-flash</code> / <code className="font-mono text-cyan-glow">gpt-4o-mini</code>
                  <br />3. DeepSeek 不支持视觉，需换其他服务商
                </p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5 shrink-0" />
              {note ?? '请核对下方结果，可直接点击修改；改完一键导入'}
            </p>
          )}
          {lowCount > 0 && (
            <p className="text-xs text-amber-400 mt-1.5 flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              有 {lowCount} 条把握较低，已用黄色标出，请重点核对
            </p>
          )}
        </div>
        <button
          onClick={reset}
          className="text-xs text-slate-400 hover:text-cyan-glow transition-colors inline-flex items-center gap-1.5 shrink-0"
          title="撤销所有修改，恢复为 AI 原始识别"
        >
          <RotateCcw className="h-3.5 w-3.5" /> 重置
        </button>
      </div>

      {/* 参数维度面板（有维度时显示） */}
      {hasDims && source !== 'error' && (
        <div className="rounded-xl border border-edge bg-brand-soft/30 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-600 flex items-center gap-1.5">
              <Sliders className="h-3.5 w-3.5 text-cyan-glow" />
              识别到的参数维度（导入后自动建好，可在此微调）
            </span>
            <button
              onClick={addDim}
              className="text-sm text-cyan-glow hover:underline inline-flex items-center gap-1"
            >
              <Plus className="h-3 w-3" /> 加维度
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {dimRows.map((d, i) => (
              <div key={i} className="flex items-center gap-1.5 rounded-lg border border-edge bg-panel/60 px-2 py-1">
                <input
                  value={d.label}
                  onChange={(e) => updateDim(i, { label: e.target.value })}
                  className="text-sm bg-transparent w-20 outline-none focus:border-cyan-glow"
                />
                {d.unit && <span className="text-sm text-slate-500">{d.unit}</span>}
                <span className="text-sm text-cyan-glow font-mono" title={d.type}>
                  {PARAM_TYPE_LABEL[d.type]}
                </span>
                <button
                  onClick={() => removeDim(i)}
                  className="text-slate-500 hover:text-red-400 ml-0.5"
                  aria-label="删除维度"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
          <p className="text-sm text-slate-500">
            符号说明：↑ 越大越好 · ↓ 越小越好 · ✓ 是/否 · A 评级。维度权重导入后默认 20，可在工作台调整。
          </p>
        </div>
      )}

      {/* 可编辑列表（横向滚动以适配多维度列） */}
      <div className="space-y-2 max-h-[42vh] overflow-y-auto pr-1">
        {/* 全同列说明：所有取值一致的列统一提示，避免逐行重复显示 */}
        {foldedNotes.length > 0 && (
          <div className="text-xs text-slate-500 mb-1 flex items-start gap-1.5">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>所有规格的 {foldedNotes.join('、')} 均一致，已折叠这些列。如有差异会自动展开。</span>
          </div>
        )}
        {/* 分组图例：第一列（口味/颜色/型号）底色 + 参数维度列色条 */}
        {((hasAnyFlavor && flavorColorMap.size > 1) || dimHasGroup.some(Boolean)) && (
          <div className="text-xs text-slate-500 mb-1 flex items-center gap-1.5 flex-wrap">
            {hasAnyFlavor && flavorColorMap.size > 1 && (
              <>
                <span>{flavorLabel}配色：</span>
                {[...flavorColorMap.entries()].map(([f, c]) => (
                  <span key={f} className={`px-1.5 py-0.5 rounded ${c} text-xs`}>{f}</span>
                ))}
              </>
            )}
            {dimHasGroup.map((has, idx) => has && (
              <span key={idx} className="inline-flex items-center gap-1 ml-2">
                <span className="text-slate-500">{dimRows[idx].label}：</span>
                {[...dimColorMaps[idx].entries()].map(([v, c]) => (
                  <span key={v} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs">
                    <span className="inline-block w-3 h-3 rounded-sm" style={{ background: c }} />
                    {v}
                  </span>
                ))}
              </span>
            ))}
          </div>
        )}
        <div className="overflow-x-auto">
          <div className="min-w-full" style={{ minWidth: paramCols > 0 ? `${420 + paramCols * 110}px` : '100%' }}>
            {/* 表头：动态构建列模板，全同列省略 */}
            {(() => {
              // 按顺序构建列定义：flavor 规格 价格 含量 [单位] [数量] [参数列...] 操作
              const cols: string[] = ['2fr', '3fr']
              if (!commonPrice) cols.push('2fr')
              if (!commonQuantity) cols.push('2fr')
              if (!commonUnit) cols.push('1fr')
              if (!commonPacks) cols.push('1fr')
              dimRows.forEach((_, i) => { if (!commonDimValues[i]) cols.push('1.2fr') })
              cols.push('0.5fr')
              const tpl = cols.join(' ')
              return (
                <div
                  className="hidden sm:grid gap-2 px-3 text-sm text-slate-500 font-medium mb-1"
                  style={{ gridTemplateColumns: tpl }}
                >
                  <span>{flavorLabel}</span>
                  <span>规格（重量×数量）</span>
                  {!commonPrice && <span>总价 ¥</span>}
                  {!commonQuantity && <span>含量</span>}
                  {!commonUnit && <span>单位</span>}
                  {!commonPacks && <span>数量</span>}
                  {dimRows.map((d, i) => !commonDimValues[i] && (
                    <span key={i} className="text-cyan-glow/80" title={`${d.label} ${PARAM_TYPE_LABEL[d.type]}`}>
                      {d.label}{d.unit ? `(${d.unit})` : ''} {PARAM_TYPE_LABEL[d.type]}
                    </span>
                  ))}
                  <span />
                </div>
              )
            })()}

            <AnimatePresence initial={false}>
              {rows.map((r, i) => {
                const low = r.confidence < LOW_CONFIDENCE
                const { flavor, spec } = parseFlavor(r.name)
                // 同口味行用同底色，仅在存在多口味时才上色（纯规格商品不上色）
                const flavorBg = hasAnyFlavor && flavor ? flavorColorMap.get(flavor) ?? '' : ''
                // 动态构建列模板，与表头一致
                const cols: string[] = ['2fr', '3fr']
                if (!commonPrice) cols.push('2fr')
                if (!commonQuantity) cols.push('2fr')
                if (!commonUnit) cols.push('1fr')
                if (!commonPacks) cols.push('1fr')
                dimRows.forEach((_, idx) => { if (!commonDimValues[idx]) cols.push('1.2fr') })
                cols.push('0.5fr')
                return (
                  <motion.div
                    key={i}
                    layout
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 12, height: 0, marginBottom: 0 }}
                    transition={{ duration: 0.15 }}
                    className={`grid gap-2 items-center rounded-xl border p-2.5 mb-1.5 ${
                      low
                        ? 'border-amber-400/50 bg-amber-400/5'
                        : 'border-edge bg-brand-soft/50'
                    } ${flavorBg && !low ? flavorBg : ''}`}
                    style={{ gridTemplateColumns: cols.join(' ') }}
                  >
                    {/* 口味/型号/颜色（根据商品类型自适应） */}
                    <div className="flex items-center gap-1.5">
                      {low && <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0" />}
                      {isBatch && r.sourceImage != null && (
                        <span
                          className="text-[9px] px-1 rounded bg-violet-500/20 text-violet-500 font-mono font-bold shrink-0"
                          title={`来自截图 ${r.sourceImage + 1}`}
                        >
                          {r.sourceImage + 1}
                        </span>
                      )}
                      <input
                        value={flavor}
                        onChange={(e) => setNameParts(i, e.target.value, spec)}
                        placeholder={flavorLabel}
                        className="field py-1.5 text-xs w-full"
                      />
                    </div>
                    {/* 规格 */}
                    <input
                      value={spec}
                      onChange={(e) => setSpec(i, e.target.value)}
                      placeholder="38g×20袋"
                      title="改这里会同步 含量/单位/数量"
                      className="field py-1.5 text-xs font-medium"
                    />
                    {!commonPrice && (
                      <input
                        type="number" min={0} step="0.01" value={r.price || ''}
                        onChange={(e) => update(i, { price: parseFloat(e.target.value) || 0 })}
                        placeholder="价格"
                        className="field py-1.5 text-xs tabular"
                      />
                    )}
                    {!commonQuantity && (
                      <input
                        type="number" min={0} value={r.quantity || ''}
                        onChange={(e) => setField(i, 'quantity', parseFloat(e.target.value) || 0)}
                        placeholder="含量"
                        title="改这里会同步规格描述"
                        className="field py-1.5 text-xs tabular"
                      />
                    )}
                    {!commonUnit && (
                      <input
                        value={r.unit}
                        onChange={(e) => setField(i, 'unit', e.target.value)}
                        placeholder="g"
                        className="field py-1.5 text-xs"
                      />
                    )}
                    {!commonPacks && (
                      <input
                        type="number" min={1} value={r.packs || ''}
                        onChange={(e) => setField(i, 'packs', parseInt(e.target.value) || 1)}
                        placeholder="数量"
                        title="改这里会同步规格描述"
                        className="field py-1.5 text-xs tabular"
                      />
                    )}
                    {/* 动态参数维度列：全同列折叠；有分组时加左侧色条 */}
                    {dimRows.map((d, idx) => !commonDimValues[idx] && (() => {
                      const v = String(r.params?.[d.label] ?? '')
                      const barColor = dimHasGroup[idx] ? dimColorMaps[idx].get(v) : undefined
                      return (
                        <input
                          key={idx}
                          value={v}
                          onChange={(e) => updateParam(i, d.label, e.target.value)}
                          placeholder={d.unit || d.label}
                          title={`${d.label}（${PARAM_TYPE_LABEL[d.type]}）`}
                          className="field py-1.5 text-xs tabular"
                          style={barColor ? { borderLeft: `3px solid ${barColor}`, paddingLeft: '8px' } : undefined}
                        />
                      )
                    })())}
                    <button
                      onClick={() => remove(i)}
                      className="justify-self-end text-slate-600 hover:text-red-400 transition-colors p-1"
                      aria-label="删除此行"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </motion.div>
                )
              })}
            </AnimatePresence>

            {/* 添加行 */}
            <button
              onClick={add}
              className="w-full rounded-xl border border-dashed border-edge hover:border-cyan-glow/50 py-2.5 text-xs text-slate-500 hover:text-cyan-glow transition-all flex items-center justify-center gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" /> 补一个 AI 漏掉的规格
            </button>
          </div>
        </div>
      </div>

      {/* 底部操作 */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1 border-t border-edge">
        <p className="text-sm text-slate-500">
          {source === 'demo' && '当前为演示识别 · '}
          {source !== 'error' && (
            <>
              有效 <span className="text-cyan-glow font-semibold tabular">{valid.length}</span> / {rows.length} 条
              {valid.length !== rows.length && '（名称/价格/含量/件数 需填全）'}
              {hasDims && ` · 将导入 ${paramCols} 个参数维度`}
              {existingCount > 0 && ` · 工作台已有 ${existingCount} 条，默认替换导入`}
            </>
          )}
          {source === 'error' && '识别失败，请检查 AI 配置后重试'}
        </p>
        <div className="flex gap-2 w-full sm:w-auto">
          <button
            onClick={onCancel}
            className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl border border-edge text-sm text-slate-600 hover:border-slate-500 transition-all"
          >
            {source === 'error' ? '关闭' : '取消'}
          </button>
          {source !== 'error' && existingCount > 0 && (
            <button
              onClick={() => onConfirm(valid, dimRows, 'append')}
              disabled={valid.length === 0}
              title="保留现有规格，把识别结果追加到后面"
              className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl border border-cyan-glow/40 text-sm text-cyan-glow hover:shadow-glow disabled:opacity-40 transition-all"
            >
              追加导入
            </button>
          )}
          {source !== 'error' && (
            <button
              onClick={() => onConfirm(valid, dimRows, existingCount > 0 ? 'replace' : 'append')}
              disabled={valid.length === 0}
              title={existingCount > 0 ? `清空现有 ${existingCount} 条规格，用识别结果替换` : undefined}
              className="flex-1 sm:flex-none px-5 py-2.5 rounded-xl bg-gradient-to-r from-brand to-emerald-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40 hover:shadow-glow active:scale-[0.98] transition-all"
            >
              <CheckCheck className="h-4 w-4" />
              {existingCount > 0 ? `替换导入 ${valid.length} 条` : `确认导入 ${valid.length} 条`}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  )
}
