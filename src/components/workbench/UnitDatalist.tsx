import { UNIT_GROUPS } from '../../lib/engine'

/** 单位建议：按量纲分组的常用单位（含换算表内新增的体积/长度/计件单位） */
export function UnitDatalist() {
  return (
    <datalist id="unit-options">
      {UNIT_GROUPS.flatMap((g) => g.units).map((u) => (
        <option key={u} value={u} />
      ))}
    </datalist>
  )
}
