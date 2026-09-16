/**
 * view-model 层（barrel）：把组件里"从数据算出来"的纯逻辑集中到这里。
 *
 * 目标：Report / Workbench 顶层只做编排与渲染，计算逻辑可被单测覆盖、可复用。
 * ⚠️ 硬约束：本目录是**纯计算层**——禁止 import '../store' / '../ai' / '../telemetry'，
 * 禁止任何网络请求、localStorage、DOM 副作用。配色等常量由调用方以参数传入
 * （见 deriveFlavorColorMap 的 palette 形参），以便 palette 独立演进。
 */
export { shortSpec, packWord, listPackWord, splitWarnText, wrapCjk } from './text'
export { buildSummaryText } from './summary'
export { buildPreferenceHint } from './preference'
export { groupComputedSkus, deriveGroupOptions } from './grouping'
export type { FullGroupBy } from './grouping'
export {
  deriveFlavorColorMap,
  deriveDimColorMaps,
  deriveDimHasGroup,
  skusHaveFlavor,
} from './colors'
export { deriveSpecRows, deriveVisualAnchorId, deriveOneLiner } from './specRows'
export type { SpecRow, OneLiner } from './specRows'
