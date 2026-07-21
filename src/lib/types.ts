// 领域模型：一个可对比的商品规格 SKU

/** 参数维度类型 */
export type ParamType = 'higher-better' | 'lower-better' | 'boolean' | 'text'

/** 参数维度定义（全局，跨所有 SKU 共享） */
export interface ParamDim {
  id: string
  label: string // 维度名，如"电池容量"
  type: ParamType
  weight: number // 0-100
  unit?: string // 单位提示，如 "mAh"
  /** text 类型专用：评级序列，按从优到劣排列，如 ["A","B","C"] */
  levels?: string[]
}

/** 单个 SKU 某维度的取值 */
export type ParamValue = number | string | undefined

export interface Sku {
  id: string
  name: string
  price: number // 总价（元）
  quantity: number // 单件含量数值（如 16）
  unit: string // 单件含量单位（如 g / ml / 个）
  packs: number // 件数 / 袋数（如 8 袋）
  // 旧版单 bonus 字段（保留用于向后兼容，新代码读 params）
  bonusLabel?: string
  bonusValue?: number
  bonusWeight?: number
  /** 新：多维参数取值，key = ParamDim.id */
  params?: Record<string, ParamValue>
}

export interface ComputedSku extends Sku {
  totalQuantity: number // 总量 = quantity * packs
  unitPrice: number // 每单位价格 = price / totalQuantity
  bonusPerYuan?: number // 每元加分量（旧字段，保留显示）
  score: number // 综合得分 0-100
  rank: number
  isBest: boolean
  /** 每个维度的 0-100 归一化分（含价格维度 'price'） */
  dimScores?: Record<string, number>
}

// 边际效益：以「基准（最便宜总量最小）」为参照，升级到大包装是否划算
export interface MarginInsight {
  fromId: string
  toId: string
  fromName: string
  toName: string
  extraCost: number // 多花的钱
  extraQuantity: number // 多买的量
  unit: string
  unitPriceDropPct: number // 单价下降百分比
  worthIt: boolean
  verdict: string
}

/**
 * 决策簇：把「定价因子相同、仅干扰维度（口味/颜色）不同」的规格聚合在一起。
 * 比价以簇为单位，簇内再挑口味 —— 把 12 选 1 降维成 4 选 1 + 簇内选口味。
 */
export interface SkuCluster {
  key: string // 定价因子指纹：quantity|packs|unit
  quantity: number
  packs: number
  unit: string
  members: ComputedSku[] // 簇内成员（不同口味等）
  repUnitPrice: number // 簇内最低每单位价格（决策依据）
  minPrice: number // 簇内最低总价
  maxPrice: number
  priceSpread: number // 簇内价格波动（>0 说明口味其实也影响价格）
  score: number // 簇综合得分（取成员最高分）
  rank: number
  isBest: boolean
  label: string // 簇标题，如 "16g × 8袋"
}

export interface DecisionResult {
  items: ComputedSku[]
  best: ComputedSku | null
  baseline: ComputedSku | null // 单价最低者（用于性价比锚点）
  margins: MarginInsight[]
  warnings: string[] // 避坑提示
  reasons: string[] // 推荐理由
  clusters: SkuCluster[] // 按定价因子聚合后的决策单元
  hasVariants: boolean // 是否存在"同定价多口味"的干扰维度
}

export type Theme = 'dark' | 'light'

/** 决策偏好 */
export type Preference = 'value' | 'score' | 'budget'

/** 决策配置：参数维度 + 价格权重 + 偏好 */
export interface DecisionConfig {
  dims: ParamDim[] // 当前任务的参数维度列表
  priceWeight: number // 价格维度自身权重（默认 50）
  preference: Preference // 决策偏好
  budget?: number // 预算上限（preference=budget 时生效）
  /** 商品类型（由截图识别自动填入，如"零食"/"手机"/"五金螺丝"），用于自适应列名 */
  category?: string
}

export interface PresetField {
  key: string
  label: string
  placeholder: string
}
