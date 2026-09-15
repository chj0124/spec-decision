import type { CategoryMode } from './types'

/**
 * 品类模板：识别到商品类型后给出计价模式与主性能维度候选，
 * 让手机/家电等耐用品自动切到「每元性能」比价，消耗品保持「每单位量」比价。
 * 未命中模板的品类回退 per-unit，绝不阻塞流程。
 */
export interface CategoryPreset {
  match: RegExp
  mode: CategoryMode
  /** per-feature 模式下主性能维度的候选名（按优先级与维度 label 模糊匹配） */
  primaryDimLabels?: string[]
}

export const CATEGORY_PRESETS: CategoryPreset[] = [
  {
    match: /手机|平板|笔记本|电脑|相机|耳机|音箱|手表|手环|路由|充电|数码|电子/i,
    mode: 'per-feature',
    primaryDimLabels: ['跑分', '性能', '电池', '续航', '存储', '内存', '容量'],
  },
  {
    match: /家电|冰箱|洗衣|空调|电视|风扇|吸尘|电饭煲|烤箱|微波|洗碗|热水|净水/i,
    mode: 'per-feature',
    primaryDimLabels: ['容量', '功率', '能效', '风量', '续航'],
  },
  {
    match: /玩具|积木|乐高|模型|玩偶|拼图|文具|笔/i,
    mode: 'per-unit',
  },
  {
    match: /零食|食品|饮料|茶叶|咖啡|坚果|蜜饯|膨化|肉脯|糕点|饼干|糖果|巧克力|方便面|挂面|调味|酱|罐头|水果|生鲜|乳|奶|酒|水/i,
    mode: 'per-unit',
  },
  {
    match: /纸巾|日化|洗护|美妆|护肤|香水|洗发|沐浴|牙膏|洗衣|清洁|卫生|日用/i,
    mode: 'per-unit',
  },
  {
    match: /五金|螺丝|工具|配件|零件|紧固|螺母|螺栓|垫片|轴承/i,
    mode: 'per-unit',
  },
  {
    match: /服装|衣服|鞋|帽|袜|穿搭|外套|裤子|裙/i,
    mode: 'per-unit',
  },
]

/** 按商品类型匹配模板；未命中返回 null（调用方回退 per-unit） */
export function matchCategoryPreset(category?: string): CategoryPreset | null {
  const c = (category ?? '').trim()
  if (!c) return null
  return CATEGORY_PRESETS.find((p) => p.match.test(c)) ?? null
}
