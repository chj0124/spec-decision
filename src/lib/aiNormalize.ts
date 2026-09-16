// AI 单位归一化：唯一涉及网络 IO 的单位换算逻辑。
//
// 之所以不放在 engine/units.ts：engine 层是纯计算内核，约定不得引入任何 IO
// （`../ai` / `../store`）。这里作为调用方，把网络调用留在 engine 之外。
import { chat } from './ai'

/**
 * 用 AI 把生僻单位归一化到基准单位（g/ml/cm/个）。
 * 仅在本地换算表查不到时调用；失败返回 null，调用方回退原样处理。
 */
export async function aiNormalizeUnit(
  quantity: number,
  unit: string,
): Promise<{ value: number; base: string } | null> {
  try {
    const text = await chat(
      `把 ${quantity} "${unit}" 换算成对应的基准单位数值。` +
        `重量用 g、体积用 ml、长度用 cm、计件用"个"。` +
        `只返回 JSON，格式 {"value":数字,"base":"g|ml|cm|个"}，不要任何其他文字。` +
        `如果该单位不属于重量/体积/长度/计件，或无法换算，返回 {"value":null}。`,
      '你是单位换算器，只输出 JSON。',
    )
    const m = text.replace(/```json|```/g, '').match(/\{[\s\S]*\}/)
    if (!m) return null
    const data = JSON.parse(m[0])
    if (typeof data.value === 'number' && data.base) return { value: data.value, base: data.base }
    return null
  } catch {
    return null
  }
}
