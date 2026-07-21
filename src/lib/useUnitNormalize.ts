import { useEffect, useRef, useState } from 'react'
import type { Sku } from './types'
import { isKnownUnit, aiNormalizeUnit, normalizeUnit } from './engine'
import { isAiReady } from './ai'

/**
 * 对含「生僻单位」的 SKU 归一化。
 * - 已知单位（g/ml/cm/个 等）：立即同步归一化，不依赖 state，保证 skus 变更后即刻返回新值。
 * - 生僻单位：AI 异步识别，结果以 override 形式合并，替换后无缝更新。
 *
 * 关键：不再用 useState 存完整 SKU 数组（会导致一个渲染周期的滞后），
 * 改为同步计算 + useRef 缓存结果（仅 3 个 hook，避免 HMR 热更新时数量变化报错）。
 */
export function useUnitNormalize(skus: Sku[]): Sku[] {
  const [aiOverrides, setAiOverrides] = useState<Record<string, { value: number; base: string }> | null>(null)

  // 单 useRef 同时存 pending fingerprint 和 memo 缓存，不增加 hook 数量
  const ref = useRef<{
    pending: string
    /** 上一次的依赖快照（用于去重，避免 skus 未变时重复计算） */
    deps: string
    /** 上一次计算的结果 */
    value: Sku[]
  }>({ pending: '', deps: '', value: skus })

  useEffect(() => {
    const unknown = skus.filter((s) => s.quantity > 0 && s.unit && !isKnownUnit(s.unit))
    if (unknown.length === 0 || !isAiReady()) {
      if (aiOverrides !== null) setAiOverrides(null)
      ref.current.pending = ''
      return
    }

    const fingerprint = JSON.stringify(unknown.map((s) => [s.id, s.quantity, s.unit]))
    if (ref.current.pending === fingerprint) return
    ref.current.pending = fingerprint

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

  // 手动 memo：依赖未变时返回缓存的数组引用（替代 useMemo，不增加 hook）
  const depsKey = skus.length > 0
    ? `${skus.length}|${aiOverrides ? Object.keys(aiOverrides).length : 0}|${skus[0].id}`
    : '0'
  if (depsKey !== ref.current.deps) {
    ref.current.deps = depsKey
    ref.current.value = skus.map((s) => {
      const ai = aiOverrides?.[s.id]
      if (ai) return { ...s, quantity: ai.value, unit: ai.base }
      const local = normalizeUnit(s.quantity, s.unit)
      return local.base !== s.unit ? { ...s, quantity: local.value, unit: local.base } : s
    })
  }
  return ref.current.value
}
