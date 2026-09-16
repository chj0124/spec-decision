import type { Sku } from '../types'

/**
 * ⚠️ engine 硬约束：本目录为**纯计算层**，禁止引入任何 IO / 副作用
 * （不得 import '../ai'、'../store'，不得发网络请求 / 读写 localStorage）。
 * 需要 IO 的能力（如 AI 生僻单位归一化 aiNormalizeUnit）一律上移到 src/lib/ 下由调用方负责。
 * 这样 engine 可离线运行、单测无需 mock，且打包可独立 tree-shake。
 */

/** 单位归一化：把大单位换算到基准小单位，避免 g/kg、ml/L 混算导致单价差千倍 */
const UNIT_TO_BASE: Record<string, { factor: number; base: string }> = {
  // 重量 → g
  kg: { factor: 1000, base: 'g' }, 千克: { factor: 1000, base: 'g' }, 公斤: { factor: 1000, base: 'g' },
  g: { factor: 1, base: 'g' }, 克: { factor: 1, base: 'g' },
  mg: { factor: 0.001, base: 'g' }, 毫克: { factor: 0.001, base: 'g' },
  ug: { factor: 0.000001, base: 'g' }, μg: { factor: 0.000001, base: 'g' }, 微克: { factor: 0.000001, base: 'g' },
  t: { factor: 1000000, base: 'g' }, 吨: { factor: 1000000, base: 'g' },
  // 市制重量 → g
  斤: { factor: 500, base: 'g' }, 两: { factor: 50, base: 'g' }, 钱: { factor: 5, base: 'g' },
  担: { factor: 50000, base: 'g' },
  // 英制重量 → g
  lb: { factor: 453.592, base: 'g' }, 磅: { factor: 453.592, base: 'g' },
  oz: { factor: 28.3495, base: 'g' }, 盎司: { factor: 28.3495, base: 'g' },
  // 体积 → ml
  l: { factor: 1000, base: 'ml' }, L: { factor: 1000, base: 'ml' }, 升: { factor: 1000, base: 'ml' },
  dl: { factor: 100, base: 'ml' }, 分升: { factor: 100, base: 'ml' },
  cl: { factor: 10, base: 'ml' }, 厘升: { factor: 10, base: 'ml' },
  ml: { factor: 1, base: 'ml' }, 毫升: { factor: 1, base: 'ml' },
  cc: { factor: 1, base: 'ml' }, 立方厘米: { factor: 1, base: 'ml' },
  // 英制/美制体积 → ml
  gal: { factor: 3785.41, base: 'ml' }, 加仑: { factor: 3785.41, base: 'ml' },
  qt: { factor: 946.353, base: 'ml' }, 夸脱: { factor: 946.353, base: 'ml' },
  pt: { factor: 473.176, base: 'ml' }, 品脱: { factor: 473.176, base: 'ml' },
  floz: { factor: 29.5735, base: 'ml' }, 液量盎司: { factor: 29.5735, base: 'ml' },
  // 长度 → cm
  km: { factor: 100000, base: 'cm' }, 千米: { factor: 100000, base: 'cm' }, 公里: { factor: 100000, base: 'cm' },
  m: { factor: 100, base: 'cm' }, 米: { factor: 100, base: 'cm' },
  cm: { factor: 1, base: 'cm' }, 厘米: { factor: 1, base: 'cm' },
  mm: { factor: 0.1, base: 'cm' }, 毫米: { factor: 0.1, base: 'cm' },
  um: { factor: 0.0001, base: 'cm' }, μm: { factor: 0.0001, base: 'cm' }, 微米: { factor: 0.0001, base: 'cm' },
  寸: { factor: 3.333, base: 'cm' }, 尺: { factor: 33.33, base: 'cm' }, 丈: { factor: 333.33, base: 'cm' },
  英寸: { factor: 2.54, base: 'cm' }, in: { factor: 2.54, base: 'cm' },
  ft: { factor: 30.48, base: 'cm' }, 英尺: { factor: 30.48, base: 'cm' },
  yd: { factor: 91.44, base: 'cm' }, 码: { factor: 91.44, base: 'cm' },
  // 计件 → 个（片剂/药丸等单件计数词，1:1 换算；"盒/瓶/袋"等容器因容量不定不并入）
  个: { factor: 1, base: '个' }, 只: { factor: 1, base: '个' }, 件: { factor: 1, base: '个' },
  枚: { factor: 1, base: '个' }, 粒: { factor: 1, base: '个' }, 片: { factor: 1, base: '个' },
  丸: { factor: 1, base: '个' }, 支: { factor: 1, base: '个' }, 条: { factor: 1, base: '个' },
  块: { factor: 1, base: '个' }, 颗: { factor: 1, base: '个' }, 张: { factor: 1, base: '个' },
  本: { factor: 1, base: '个' }, 卷: { factor: 1, base: '个' }, 双: { factor: 1, base: '个' },
  副: { factor: 1, base: '个' }, 把: { factor: 1, base: '个' }, 贴: { factor: 1, base: '个' },
  剂: { factor: 1, base: '个' },
  // 计件倍数词
  打: { factor: 12, base: '个' }, 罗: { factor: 144, base: '个' }, 令: { factor: 500, base: '个' },
}

/** 供 UI 提示：按量纲归类的常用单位（仅用于展示与占位符，不参与计算） */
export const UNIT_GROUPS: Array<{ label: string; base: string; units: string[] }> = [
  { label: '重量', base: 'g', units: ['g', 'kg', 'mg', '斤', '两', '磅', '盎司'] },
  { label: '体积', base: 'ml', units: ['ml', 'L', 'cc', 'dl', '加仑', '夸脱', '品脱'] },
  { label: '长度', base: 'cm', units: ['cm', 'm', 'mm', '英寸', '英尺', '码', '尺', '寸'] },
  { label: '计件', base: '个', units: ['个', '片', '粒', '丸', '支', '条', '块', '枚', '贴', '剂', '打'] },
]

/** 把 (quantity, unit) 归一化到基准单位，返回 { value, base }；无法识别的单位原样返回 */
export function normalizeUnit(quantity: number, unit: string): { value: number; base: string } {
  const u = (unit || '').trim()
  const rule = UNIT_TO_BASE[u] ?? UNIT_TO_BASE[u.toLowerCase()]
  if (rule) return { value: quantity * rule.factor, base: rule.base }
  return { value: quantity, base: u }
}

/** 该单位是否在本地换算表内（决定是否需要 AI 兜底） */
export function isKnownUnit(unit: string): boolean {
  const u = (unit || '').trim()
  return Boolean(UNIT_TO_BASE[u] ?? UNIT_TO_BASE[u.toLowerCase()])
}

/** 检测一批 SKU 是否存在"基准单位不一致、无法直接比价"的情况，返回警告文案或 null */
export function unitMixWarning(skus: Sku[]): string | null {
  const bases = new Set<string>()
  for (const s of skus) {
    if (!(s.quantity > 0)) continue
    bases.add(normalizeUnit(s.quantity, s.unit).base || s.unit)
  }
  // 同一物理量纲的基准才可比；g/ml/cm/个 属不同量纲，出现多个且非同一类 → 警告
  const arr = [...bases]
  if (arr.length > 1) {
    return `检测到多种计量单位（${arr.join('、')}），它们属于不同维度，无法直接比价。请统一为同一单位后再看结果。`
  }
  return null
}
