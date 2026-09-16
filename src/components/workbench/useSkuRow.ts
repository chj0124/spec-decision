import type { Sku } from '../../lib/types'
import { parseFlavor, parseSpec, buildSpec } from '../../lib/engine'

/** 单行 SKU 的派生状态与「口味/规格/含量/单位/数量」双向同步编辑逻辑（桌面表格行与移动端卡片共用） */
export function useSkuRow(s: Sku, update: (id: string, patch: Partial<Sku>) => void) {
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
