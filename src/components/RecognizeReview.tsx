import { useState } from 'react'
import type { RecognizedSku, RecognizedDim } from '../lib/recognize'
import { LOW_CONFIDENCE } from '../lib/recognize'
import { parseFlavor, parseSpec, buildSpec } from '../lib/engine'
import type { ParamType } from '../lib/types'
import { AlertCircle, Plus, Trash2, CheckCheck, RotateCcw, Info, Tag, Sliders } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface Props {
  image: string
  items: RecognizedSku[]
  source: 'api' | 'demo' | 'error'
  note?: string
  /** AI 识别到的商品类型，如"手机" */
  category?: string
  /** AI 识别到的参数维度定义 */
  dims?: RecognizedDim[]
  onConfirm: (items: RecognizedSku[], dims?: RecognizedDim[]) => void
  onCancel: () => void
}

const PARAM_TYPE_LABEL: Record<ParamType, string> = {
  'higher-better': '↑',
  'lower-better': '↓',
  'boolean': '✓',
  'text': 'A',
}

const blank = (): RecognizedSku => ({
  name: '', price: 0, quantity: 0, unit: 'g', packs: 1, confidence: 1,
})

export default function RecognizeReview({
  image, items, source, note, category, dims, onConfirm, onCancel,
}: Props) {
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
  const reset = () => { setRows(items); setDimRows(dims ?? []) }

  const lowCount = rows.filter((r) => r.confidence < LOW_CONFIDENCE).length
  const valid = rows.filter((r) => r.name.trim() && r.price > 0 && r.quantity > 0 && r.packs > 0)
  const hasDims = dimRows.length > 0

  // 动态列宽：基础字段占 12 列中的 11 列，每个 param 维度挤一点
  // 简化处理：param 维度多时整行改为可横向滚动
  const paramCols = dimRows.length

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass rounded-3xl p-5 sm:p-6 space-y-5"
    >
      {/* 头部 */}
      <div className="flex flex-col sm:flex-row gap-4 sm:items-start">
        <div className="h-20 w-20 rounded-xl overflow-hidden border border-edge shrink-0">
          <img src={image} alt="识别截图" className="h-full w-full object-cover" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-bold tracking-tight flex items-center gap-2 flex-wrap">
            {source === 'error' ? '识别失败' : '确认识别结果'}
            {source !== 'error' && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-glow/15 text-cyan-glow font-semibold">
                {rows.length} 个规格
              </span>
            )}
            {category && source !== 'error' && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-brand-soft border border-edge text-slate-600 font-medium inline-flex items-center gap-1">
                <Tag className="h-3 w-3" /> {category}
              </span>
            )}
            {hasDims && source !== 'error' && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 font-medium inline-flex items-center gap-1">
                <Sliders className="h-3 w-3" /> {paramCols} 个参数维度
              </span>
            )}
          </h3>
          {source === 'error' ? (
            <div className="mt-2 rounded-xl border border-red-400/40 bg-red-500/10 p-3 flex gap-2">
              <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-red-600 mb-1">视觉模型调用失败</p>
                <p className="text-[11px] text-red-500 leading-relaxed break-all">{note}</p>
                <p className="text-[11px] text-slate-500 mt-2">
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
            <span className="text-[11px] font-semibold text-slate-600 flex items-center gap-1.5">
              <Sliders className="h-3.5 w-3.5 text-cyan-glow" />
              识别到的参数维度（导入后自动建好，可在此微调）
            </span>
            <button
              onClick={addDim}
              className="text-[11px] text-cyan-glow hover:underline inline-flex items-center gap-1"
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
                  className="text-[11px] bg-transparent w-20 outline-none focus:border-cyan-glow"
                />
                {d.unit && <span className="text-[10px] text-slate-500">{d.unit}</span>}
                <span className="text-[10px] text-cyan-glow font-mono" title={d.type}>
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
          <p className="text-[10px] text-slate-500">
            符号说明：↑ 越大越好 · ↓ 越小越好 · ✓ 是/否 · A 评级。维度权重导入后默认 20，可在工作台调整。
          </p>
        </div>
      )}

      {/* 可编辑列表（横向滚动以适配多维度列） */}
      <div className="space-y-2 max-h-[42vh] overflow-y-auto pr-1">
        <div className="overflow-x-auto">
          <div className="min-w-full" style={{ minWidth: paramCols > 0 ? `${520 + paramCols * 110}px` : '100%' }}>
            {/* 表头 */}
            <div
              className="hidden sm:grid gap-2 px-3 text-[10px] text-slate-500 font-medium mb-1"
              style={{ gridTemplateColumns: `2fr 3fr 2fr 2fr 1fr 1fr${paramCols > 0 ? ` repeat(${paramCols}, 1.2fr)` : ''} 0.5fr` }}
            >
              <span>口味</span>
              <span>规格（重量×数量）</span>
              <span>总价 ¥</span>
              <span>含量</span>
              <span>单位</span>
              <span>数量</span>
              {dimRows.map((d, i) => (
                <span key={i} className="text-cyan-glow/80" title={`${d.label} ${PARAM_TYPE_LABEL[d.type]}`}>
                  {d.label}{d.unit ? `(${d.unit})` : ''} {PARAM_TYPE_LABEL[d.type]}
                </span>
              ))}
              <span />
            </div>

            <AnimatePresence initial={false}>
              {rows.map((r, i) => {
                const low = r.confidence < LOW_CONFIDENCE
                const { flavor, spec } = parseFlavor(r.name)
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
                    }`}
                    style={{ gridTemplateColumns: `2fr 3fr 2fr 2fr 1fr 1fr${paramCols > 0 ? ` repeat(${paramCols}, 1.2fr)` : ''} 0.5fr` }}
                  >
                    {/* 口味 */}
                    <div className="flex items-center gap-1.5">
                      {low && <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0" />}
                      <input
                        value={flavor}
                        onChange={(e) => setNameParts(i, e.target.value, spec)}
                        placeholder="口味"
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
                    <input
                      type="number" min={0} step="0.01" value={r.price || ''}
                      onChange={(e) => update(i, { price: parseFloat(e.target.value) || 0 })}
                      placeholder="价格"
                      className="field py-1.5 text-xs tabular"
                    />
                    <input
                      type="number" min={0} value={r.quantity || ''}
                      onChange={(e) => setField(i, 'quantity', parseFloat(e.target.value) || 0)}
                      placeholder="含量"
                      title="改这里会同步规格描述"
                      className="field py-1.5 text-xs tabular"
                    />
                    <input
                      value={r.unit}
                      onChange={(e) => setField(i, 'unit', e.target.value)}
                      placeholder="g"
                      className="field py-1.5 text-xs"
                    />
                    <input
                      type="number" min={1} value={r.packs || ''}
                      onChange={(e) => setField(i, 'packs', parseInt(e.target.value) || 1)}
                      placeholder="数量"
                      title="改这里会同步规格描述"
                      className="field py-1.5 text-xs tabular"
                    />
                    {/* 动态参数维度列 */}
                    {dimRows.map((d, idx) => (
                      <input
                        key={idx}
                        value={r.params?.[d.label] ?? ''}
                        onChange={(e) => updateParam(i, d.label, e.target.value)}
                        placeholder={d.unit || d.label}
                        title={`${d.label}（${PARAM_TYPE_LABEL[d.type]}）`}
                        className="field py-1.5 text-xs tabular"
                      />
                    ))}
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
        <p className="text-[11px] text-slate-500">
          {source === 'demo' && '当前为演示识别 · '}
          {source !== 'error' && (
            <>
              有效 <span className="text-cyan-glow font-semibold tabular">{valid.length}</span> / {rows.length} 条
              {valid.length !== rows.length && '（名称/价格/含量/件数 需填全）'}
              {hasDims && ` · 将导入 ${paramCols} 个参数维度`}
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
          {source !== 'error' && (
            <button
              onClick={() => onConfirm(valid, dimRows)}
              disabled={valid.length === 0}
              className="flex-1 sm:flex-none px-5 py-2.5 rounded-xl bg-gradient-to-r from-brand to-emerald-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40 hover:shadow-glow active:scale-[0.98] transition-all"
            >
              <CheckCheck className="h-4 w-4" /> 确认导入 {valid.length} 条
            </button>
          )}
        </div>
      </div>
    </motion.div>
  )
}
