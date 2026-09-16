import type { ParamDim, ParamValue, Sku } from '../../lib/types'
import { AutoWidthInput } from './AutoWidthInput'

/** 维度值输入控件：按维度类型渲染 数字 / 是否 / 评级（桌面表格行与移动端卡片共用） */
export function DimInput({ dim, s, updateParam, className = '' }: {
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
