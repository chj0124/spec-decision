import type { ParamDim, Sku } from '../types'
import { parseFlavor } from '../engine'

/**
 * 第一分组维度（口味/颜色/型号）行底色的稳定映射：
 * 按 SKU 出现顺序把「出现过的口味值」依次映射到调色板，保证同名口味颜色一致。
 */
export function deriveFlavorColorMap(
  items: Array<{ name: string }>,
  palette: string[],
): Map<string, string> {
  const map = new Map<string, string>()
  let idx = 0
  for (const it of items) {
    const f = parseFlavor(it.name).flavor || ''
    if (f && !map.has(f)) {
      map.set(f, palette[idx % palette.length])
      idx++
    }
  }
  return map
}

/** 参数维度列左侧色条：每个维度独立地把「出现过的取值」映射到色板 */
export function deriveDimColorMaps(
  skus: Sku[],
  dims: ParamDim[],
  palette: string[],
): Array<Map<string, string>> {
  return dims.map((d) => {
    const map = new Map<string, string>()
    let idx = 0
    for (const s of skus) {
      const v = String(s.params?.[d.id] ?? '')
      if (v && !map.has(v)) {
        map.set(v, palette[idx % palette.length])
        idx++
      }
    }
    return map
  })
}

/** 维度是否形成"分组"（该维度下取值 ≥2 种）——单色条没有分组意义，不展示 */
export const deriveDimHasGroup = (dimColorMaps: Array<Map<string, string>>): boolean[] =>
  dimColorMaps.map((m) => m.size >= 2)

/** 清单里是否存在"口味"这一干扰维度（决定是否展示口味分组与图例） */
export const skusHaveFlavor = (skus: Array<{ name: string }>): boolean =>
  skus.some((s) => parseFlavor(s.name).flavor)
