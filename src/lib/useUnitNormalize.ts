import { useEffect, useRef, useState } from 'react'
import type { Sku } from './types'
import { isKnownUnit, aiNormalizeUnit } from './engine'
import { isAiReady } from './ai'

/**
 * 对含「生僻单位」的 SKU，用 AI 异步归一化，返回单位已统一的新列表。
 * 本地表已知的单位不动；AI 未配置或失败则原样保留（按各自单位算，报告页会有混杂警告）。
 * 结果通过返回值替换，期间不阻塞渲染（先用原始值，AI 完成后无缝替换）。
 */
export function useUnitNormalize(skus: Sku[]): Sku[] {
  const [normalized, setNormalized] = useState<Sku[]>(skus)
  const pendingRef = useRef<string>('')

  useEffect(() => {
    // 找出本地表不认识的单位
    const unknown = skus.filter((s) => s.quantity > 0 && s.unit && !isKnownUnit(s.unit))
    if (unknown.length === 0 || !isAiReady()) {
      setNormalized(skus)
      return
    }

    // 避免对同一批数据重复请求
    const fingerprint = JSON.stringify(unknown.map((s) => [s.id, s.quantity, s.unit]))
    if (pendingRef.current === fingerprint) return
    pendingRef.current = fingerprint

    let cancelled = false
    ;(async () => {
      const next = await Promise.all(
        skus.map(async (s) => {
          if (s.quantity > 0 && s.unit && !isKnownUnit(s.unit)) {
            const r = await aiNormalizeUnit(s.quantity, s.unit)
            if (r && r.value > 0) {
              // 把生僻单位换算为基准单位：value 作为新 quantity、base 作为新 unit
              return { ...s, quantity: r.value, unit: r.base }
            }
          }
          return s
        }),
      )
      if (!cancelled) setNormalized(next)
    })()

    return () => {
      cancelled = true
    }
  }, [skus])

  return normalized
}
