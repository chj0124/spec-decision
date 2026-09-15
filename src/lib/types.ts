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

/** 一次价格记录：某时刻该规格的总价（元） */
export interface PricePoint {
  t: number
  price: number
}

export interface Sku {
  id: string
  name: string
  price: number // 总价（元）
  quantity: number // 单件含量数值（如 16）
  unit: string // 单件含量单位（如 g / ml / 个）
  packs: number // 件数 / 袋数（如 8 袋）
  /** 件数量词（如 袋/瓶/罐/盒），仅用于规格描述展示，不影响计算。缺省回退"袋" */
  packUnit?: string
  // 旧版单 bonus 字段（保留用于向后兼容，新代码读 params）
  bonusLabel?: string
  bonusValue?: number
  bonusWeight?: number
  /** 新：多维参数取值，key = ParamDim.id */
  params?: Record<string, ParamValue>
  /** 价格历史：历次录入的总价（同日合并、条数有上限），用于提示涨价/降价 */
  priceHistory?: PricePoint[]
}

export interface ComputedSku extends Sku {
  totalQuantity: number // 总量 = quantity * packs
  unitPrice: number // 每单位价格 = price / totalQuantity
  packPrice: number // 每包价格 = price / packs（"包"指件/袋，对消费者比每g更直观）
  bonusPerYuan?: number // 每元加分量（旧字段，保留显示）
  score: number // 综合得分 0-100
  rank: number
  isBest: boolean
  /** 每个维度的 0-100 归一化分（含价格维度 'price'） */
  dimScores?: Record<string, number>
  /** 性价比锚点值（由 decide 填充）：per-unit=每单位价格；per-feature=每元性能（主参数÷总价） */
  anchorValue?: number
  /** 锚点展示标签，如 "每g价格" / "每元电池容量" */
  anchorLabel?: string
  /** 锚点方向：true=越大越好（每元性能），false=越小越好（单位价） */
  anchorHigherBetter?: boolean
}

/** 边际效益分级 */
export type MarginGrade = 'great' | 'good' | 'fair' | 'poor' | 'bad'

// 边际效益：以「基准（最便宜总量最小）」为参照，升级到大包装是否划算
export interface MarginInsight {
  fromId: string
  toId: string
  fromName: string
  toName: string
  extraCost: number // 多花的钱
  extraQuantity: number // 多买的量
  unit: string
  unitPriceDropPct: number // 单价下降百分比（正=降价，负=涨价）
  /** 每多买 1 基准单位量所节省的钱（元/单位），正值=省，负值=亏 */
  marginalSaving: number
  /** 净省/净亏（元）：多得的量按前档单价折算价值 - 多花的钱。正=省，负=亏。比每单位省更直观 */
  netSaving: number
  /** 分级（更精细的结论，替代原 worthIt 布尔值） */
  grade: MarginGrade
  worthIt: boolean // 保留向后兼容：grade 为 great/good 时为 true
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
  /** 预算偏好下被"超预算"过滤掉的规格数（items 为空时用于区分"没数据"与"预算内无匹配"） */
  budgetExcluded: number
}

/** 量纲分组决策结果：混量纲清单按基准单位（g/ml/cm/个）拆组后，每组独立跑一次决策 */
export interface UnitGroupResult {
  base: string // 基准单位（g/ml/cm/个 或未知单位原样）
  result: DecisionResult
}

export type Theme = 'dark' | 'light'

/** 决策偏好 */
export type Preference = 'value' | 'score' | 'budget'

/**
 * 计价模式：
 * - per-unit    消耗品（饮料/零食/纸巾）：按每单位量（g/ml/个）比价，越低越好
 * - per-feature 耐用品（手机/家电）：按每元性能（主参数÷总价）比价，越高越好
 */
export type CategoryMode = 'per-unit' | 'per-feature'

/** 决策配置：参数维度 + 价格权重 + 偏好 */
export interface DecisionConfig {
  dims: ParamDim[] // 当前任务的参数维度列表
  priceWeight: number // 价格维度自身权重（默认 50）
  preference: Preference // 决策偏好
  /** 计价模式，缺省 per-unit */
  mode?: CategoryMode
  /** per-feature 模式的主性能维度 id（应指向数值型 higher-better 维度），每元性能 = 该维度值 ÷ 总价 */
  primaryDimId?: string
  budget?: number // 预算上限（preference=budget 时生效）
  /** 商品类型（由截图识别自动填入，如"零食"/"手机"/"五金螺丝"），用于自适应列名 */
  category?: string
  /** AI 建议的"口味列"列名（如"口味"/"型号"/"颜色"），优先于 inferFlavorLabel */
  flavorLabel?: string
}

export interface PresetField {
  key: string
  label: string
  placeholder: string
}
