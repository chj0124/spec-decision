import { useState } from 'react'
import type { RecognizedSku } from '../lib/recognize'
import { LOW_CONFIDENCE } from '../lib/recognize'
import { parseFlavor, parseSpec, buildSpec } from '../lib/engine'
import { AlertCircle, Plus, Trash2, CheckCheck, RotateCcw, Info } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface Props {
  image: string
  items: RecognizedSku[]
  source: 'api' | 'demo'
  note?: string
  onConfirm: (items: RecognizedSku[]) => void
  onCancel: () => void
}

const blank = (): RecognizedSku => ({
  name: '', price: 0, quantity: 0, unit: 'g', packs: 1, confidence: 1,
})

export default function RecognizeReview({ image, items, source, note, onConfirm, onCancel }: Props) {
  const [rows, setRows] = useState<RecognizedSku[]>(items)

  const update = (i: number, patch: Partial<RecognizedSku>) =>
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch, confidence: 1 } : r)))

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
  const reset = () => setRows(items)

  const lowCount = rows.filter((r) => r.confidence < LOW_CONFIDENCE).length
  const valid = rows.filter((r) => r.name.trim() && r.price > 0 && r.quantity > 0 && r.packs > 0)

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
          <h3 className="text-lg font-bold tracking-tight flex items-center gap-2">
            确认识别结果
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-glow/15 text-cyan-glow font-semibold">
              {rows.length} 个规格
            </span>
          </h3>
          <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
            <Info className="h-3.5 w-3.5 shrink-0" />
            {note ?? '请核对下方结果，可直接点击修改；改完一键导入'}
          </p>
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

      {/* 可编辑列表 */}
      <div className="space-y-2 max-h-[46vh] overflow-y-auto pr-1">
        {/* 表头（桌面端） */}
        <div className="hidden sm:grid grid-cols-12 gap-2 px-3 text-[10px] text-slate-500 font-medium">
          <span className="col-span-2">口味</span>
          <span className="col-span-3">规格（重量×数量）</span>
          <span className="col-span-2">总价 ¥</span>
          <span className="col-span-2">含量</span>
          <span className="col-span-1">单位</span>
          <span className="col-span-1">数量</span>
          <span className="col-span-1" />
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
                className={`grid grid-cols-2 sm:grid-cols-12 gap-2 items-center rounded-xl border p-2.5 ${
                  low
                    ? 'border-amber-400/50 bg-amber-400/5'
                    : 'border-edge bg-brand-soft/50'
                }`}
              >
                {/* 口味 */}
                <div className="col-span-1 sm:col-span-2 flex items-center gap-1.5">
                  {low && <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0" />}
                  <input
                    value={flavor}
                    onChange={(e) => setNameParts(i, e.target.value, spec)}
                    placeholder="口味"
                    className="field py-1.5 text-xs"
                  />
                </div>
                {/* 规格（重量×数量），与含量/单位/数量双向同步 */}
                <input
                  value={spec}
                  onChange={(e) => setSpec(i, e.target.value)}
                  placeholder="38g×20袋"
                  title="改这里会同步 含量/单位/数量"
                  className="field py-1.5 text-xs font-medium col-span-1 sm:col-span-3"
                />
                <input
                  type="number" min={0} step="0.01" value={r.price || ''}
                  onChange={(e) => update(i, { price: parseFloat(e.target.value) || 0 })}
                  placeholder="价格"
                  className="field py-1.5 text-xs tabular col-span-1 sm:col-span-2"
                />
                <input
                  type="number" min={0} value={r.quantity || ''}
                  onChange={(e) => setField(i, 'quantity', parseFloat(e.target.value) || 0)}
                  placeholder="含量"
                  title="改这里会同步规格描述"
                  className="field py-1.5 text-xs tabular col-span-1 sm:col-span-2"
                />
                <input
                  value={r.unit}
                  onChange={(e) => setField(i, 'unit', e.target.value)}
                  placeholder="g"
                  className="field py-1.5 text-xs col-span-1"
                />
                <input
                  type="number" min={1} value={r.packs || ''}
                  onChange={(e) => setField(i, 'packs', parseInt(e.target.value) || 1)}
                  placeholder="数量"
                  title="改这里会同步规格描述"
                  className="field py-1.5 text-xs tabular col-span-1"
                />
                <button
                  onClick={() => remove(i)}
                  className="col-span-1 justify-self-end text-slate-600 hover:text-red-400 transition-colors p-1"
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

      {/* 底部操作 */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1 border-t border-edge">
        <p className="text-[11px] text-slate-500">
          {source === 'demo' && '当前为演示识别 · '}
          有效 <span className="text-cyan-glow font-semibold tabular">{valid.length}</span> / {rows.length} 条
          {valid.length !== rows.length && '（名称/价格/含量/件数 需填全）'}
        </p>
        <div className="flex gap-2 w-full sm:w-auto">
          <button
            onClick={onCancel}
            className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl border border-edge text-sm text-slate-600 hover:border-slate-500 transition-all"
          >
            取消
          </button>
          <button
            onClick={() => onConfirm(valid)}
            disabled={valid.length === 0}
            className="flex-1 sm:flex-none px-5 py-2.5 rounded-xl bg-gradient-to-r from-brand to-emerald-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40 hover:shadow-glow active:scale-[0.98] transition-all"
          >
            <CheckCheck className="h-4 w-4" /> 确认导入 {valid.length} 条
          </button>
        </div>
      </div>
    </motion.div>
  )
}
