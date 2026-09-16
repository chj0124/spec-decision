import { useEffect, useMemo, useRef, useState } from 'react'
import type { Sku } from './types'
import { isKnownUnit, aiNormalizeUnit, normalizeUnit } from './engine'
import { isAiReady } from './ai'

/**
 * 对含「生僻单位」的 SKU 归一化。
 * - 已知单位（g/ml/cm/个 等）：立即同步归一化，不依赖 state，保证 skus 变更后即刻返回新值。
 * - 生僻单位：AI 异步识别，结果以 override 形式合并，替换后无缝更新。
 *
 * 关键：useMemo 依赖 [skus, aiOverrides]，skus 引用变化时必定重新计算，
 * 不会因手动 depsKey 遗漏字段导致数据陈旧。
 */
export function useUnitNormalize(skus: Sku[]): Sku[] {
  const [aiOverrides, setAiOverrides] = useState<Record<string, { value: number; base: string }> | null>(null)
  const pendingRef = useRef('')

  useEffect(() => {
    const unknown = skus.filter((s) => s.quantity > 0 && s.unit && !isKnownUnit(s.unit))
    if (unknown.length === 0 || !isAiReady()) {
      if (aiOverrides !== null) setAiOverrides(null)
      pendingRef.current = ''
      return
    }

    const fingerprint = JSON.stringify(unknown.map((s) => [s.id, s.quantity, s.unit]))
    if (pendingRef.current === fingerprint) return
    pendingRef.current = fingerprint

    let cancelled = false
    ;(async () => {
      const overrides: Record<string, { value: number; base: string }> = {}
      await Promise.all(
        unknown.map(async (s) => {
          const r = await aiNormalizeUnit(s.quantity, s.unit)
          if (r && r.value > 0) overrides[s.id] = r
        }),
      )
      if (!cancelled) setAiOverrides(Object.keys(overrides).length > 0 ? overrides : null)
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skus])

  // useMemo 依赖 [skus, aiOverrides]：skus 引用变更（如用户修改任意字段）必定重新计算，
  // 不会像手动 depsKey 那样漏掉字段更新。
  return useMemo(
    () =>
      skus.map((s) => {
        const ai = aiOverrides?.[s.id]
        if (ai) return { ...s, quantity: ai.value, unit: ai.base }
        const local = normalizeUnit(s.quantity, s.unit)
        return local.base !== s.unit ? { ...s, quantity: local.value, unit: local.base } : s
      }),
    [skus, aiOverrides],
  )
}
