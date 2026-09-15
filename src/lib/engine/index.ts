/**
 * engine 模块聚合出口（barrel）。
 *
 * 历史上这里是单个 700+ 行的 engine.ts，后来按职责拆分为：
 *  - util     纯工具（uid / fmt）
 *  - units    单位归一化与混单位检测
 *  - spec     口味拆分、分组折叠、规格描述双向解析
 *  - scoring  单 SKU 派生值、多维加权评分、边际分析、提示文案
 *  - clusters 同款分簇与按偏好排序
 *  - decide   决策主入口
 *
 * 所有调用方仍以 `from './engine'` / `'../lib/engine'` 引用，拆分对调用方完全透明。
 */
export { uid, fmt } from './util'

export {
  UNIT_GROUPS,
  normalizeUnit,
  isKnownUnit,
  aiNormalizeUnit,
  unitMixWarning,
} from './units'

export { parseFlavor, groupSkus, parseSpec, buildSpec, SPEC_PATTERN } from './spec'
export type { GroupBy, SpecParts } from './spec'

export {
  MAX_PRICE_POINTS,
  recordPrice,
  sanitizePriceHistory,
  priceTrend,
  fmtPointDay,
} from './history'
export type { PriceTrend } from './history'

export {
  computeSku,
  scoreItems,
  marginAnalysis,
  buildWarnings,
  buildReasons,
  inferFlavorLabel,
  mergeVariantSkus,
} from './scoring'

export { clusterItems, rankByPreference } from './clusters'

export { decide } from './decide'
