import type { DecisionConfig, ParamDim, ParamType } from '../../lib/types'
import { palette } from '../../lib/palette'
import { ChevronDown, PieChart as PieIcon, Plus, Sliders, Trash2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import WeightPie from '../WeightPie'
import { AutoWidthInput } from './AutoWidthInput'
import { PARAM_TYPE_LABELS, WEIGHT_TIERS, isNumericType } from './constants'

export interface DimPanelProps {
  config: DecisionConfig
  onConfigChange: (c: DecisionConfig) => void
  open: boolean
  onToggle: () => void
  addDim: () => void
  updateDim: (id: string, patch: Partial<ParamDim>) => void
  removeDim: (id: string) => void
}

/** 参数维度 + 权重面板：价格权重、维度增删改、权重饼图 */
export function DimPanel({
  config,
  onConfigChange,
  open,
  onToggle,
  addDim,
  updateDim,
  removeDim,
}: DimPanelProps) {
  // 权重饼图数据：价格 + 所有维度
  const pieData = [
    { name: '价格', value: Math.max(0, config.priceWeight), color: palette.pie[0] },
    ...config.dims.map((d, i) => ({
      name: d.label,
      value: Math.max(0, d.weight),
      color: palette.pie[(i + 1) % palette.pie.length],
    })),
  ].filter((d) => d.value > 0)

  return (
    <div className="glass rounded-2xl overflow-hidden">
      <button
        onClick={onToggle}
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
          className={`h-4 w-4 text-slate-500 transition-transform ${open ? '' : '-rotate-90'}`}
        />
      </button>

      <AnimatePresence>
        {open && (
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
  )
}
